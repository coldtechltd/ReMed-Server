import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SentryCron } from '@sentry/nestjs';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  eq,
  and,
  or,
  gte,
  lte,
  lt,
  isNull,
  inArray,
  isNotNull,
} from 'drizzle-orm';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import * as schema from '../db/schema';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { CronLockService } from '../common/cron-lock/cron-lock.service';
import { UpdateNotificationPreferencesDto } from './dto/notification-preference.dto';
import { isWithinQuietHours } from './quiet-hours.util';
import {
  projectStock,
  daysUntil,
  REFILL_LEAD_TIME_DAYS,
} from '../dosage-form/stock.util';
import {
  companionMissedDoseCopy,
  companionRefillCopy,
  MissedDoseItem,
} from '../companion/companion-notification.util';

// A ticket only says Expo accepted the message; whether FCM/APNs actually
// delivered it shows up minutes later in the receipt. Expo asks for a wait
// before the first lookup, and keeps receipts around for 24h.
const RECEIPT_CHECK_DELAY_MS = 5 * 60 * 1000;
const RECEIPT_GIVE_UP_MS = 60 * 60 * 1000;
// Guard against unbounded growth if the receipt API is down for a long stretch.
const MAX_PENDING_RECEIPTS = 5000;
/**
 * How long delivery rows are kept. Long enough to answer "why didn't I get my
 * reminder last week?" and to compute a monthly delivery rate; short enough
 * that the table doesn't grow without bound at users x doses-per-day.
 */
const DELIVERY_LOG_RETENTION_DAYS = 30;

// A dose marked missed more than a day ago is history, not news — alerting a
// companion about it then is noise, and it also bounds this query's scan.
const COMPANION_MISSED_LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface PendingReceipt {
  ticketId: string;
  /** Kept so a DeviceNotRegistered receipt can be traced back to its device. */
  pushToken: string;
  queuedAt: number;
}

/** Push categories the delivery log distinguishes. */
type DeliveryCategory =
  | 'dose_reminder'
  | 'refill_reminder'
  | 'companion_missed_dose'
  | 'companion_refill';

/**
 * Per-message attribution for the delivery log, index-aligned with the
 * ExpoPushMessage[] handed to sendPush.
 */
interface DeliveryContext {
  userId: string;
  category: DeliveryCategory;
  /** Dose event id, or dosage form id for refills. */
  refId?: string | null;
}

type NewDeliveryRow = typeof schema.notificationDeliveries.$inferInsert;
type PreferenceRow = typeof schema.notificationPreferences.$inferSelect;

@Injectable()
export class NotificationsService {
  private expo: Expo;
  private readonly logger = new Logger(NotificationsService.name);
  // In memory on purpose: receipts are a diagnostic, not state worth a table.
  // A restart loses at most one window of them.
  private pendingReceipts: PendingReceipt[] = [];

  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly cronLock: CronLockService,
  ) {
    this.expo = new Expo();
  }

  /**
   * What a user gets before they ever open the settings screen. Mirrors the
   * column defaults; kept here too so reads don't have to create a row.
   */
  static readonly DEFAULT_PREFERENCES = {
    doseRemindersEnabled: true,
    refillRemindersEnabled: true,
    companionAlertsEnabled: true,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    defaultSnoozeMinutes: 15,
    timezone: null as string | null,
  };

  async getPreferences(userId: string) {
    const [row] = await this.db
      .select()
      .from(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, userId));

    return row ?? { userId, ...NotificationsService.DEFAULT_PREFERENCES };
  }

  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ) {
    // Upsert: the row is created on first save rather than at signup, so
    // users who never touch these settings cost nothing.
    const [row] = await this.db
      .insert(schema.notificationPreferences)
      .values({ ...NotificationsService.DEFAULT_PREFERENCES, ...dto, userId })
      .onConflictDoUpdate({
        target: schema.notificationPreferences.userId,
        set: { ...dto, updatedAt: new Date() },
      })
      .returning();

    return row;
  }

  /**
   * Preferences for many users at once, keyed by user id.
   *
   * The crons decide who to notify in one pass, so they need this as a lookup
   * rather than a query per recipient. Users with no row are absent from the
   * map and callers fall back to DEFAULT_PREFERENCES.
   */
  private async preferencesFor(userIds: string[]) {
    if (userIds.length === 0) return new Map<string, PreferenceRow>();
    const rows = await this.db
      .select()
      .from(schema.notificationPreferences)
      .where(inArray(schema.notificationPreferences.userId, userIds));
    return new Map(rows.map((r) => [r.userId, r]));
  }

  /**
   * Should we send an ambient (non-dose) notification to this user right now?
   *
   * `channel` picks which opt-out applies. `respectQuietHours` must only be
   * true for a caller that will genuinely retry later, because skipping is a
   * *deferral* — and a deferral that never comes back around is just silent
   * data loss. The hourly companion cron retries within the hour; the daily
   * refill cron fires once at a fixed UTC time, so for a user whose local
   * clock puts that instant inside their quiet window, skipping would drop the
   * reminder every single day forever. Refills therefore honour the opt-out
   * toggle but not quiet hours.
   */
  private ambientAllowed(
    prefs: PreferenceRow | undefined,
    channel: 'refill' | 'companion',
    now: Date,
    { respectQuietHours }: { respectQuietHours: boolean },
  ): boolean {
    const p = prefs ?? NotificationsService.DEFAULT_PREFERENCES;
    const enabled =
      channel === 'refill'
        ? p.refillRemindersEnabled
        : p.companionAlertsEnabled;
    if (!enabled) return false;
    return respectQuietHours ? !isWithinQuietHours(now, p) : true;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @SentryCron('send-dose-reminders', {
    schedule: { type: 'crontab', value: '*/1 * * * *' },
    checkinMargin: 2,
    maxRuntime: 5,
    timezone: 'UTC',
  })
  async handleReminders() {
    this.logger.debug('Checking for pending dose events to send reminders...');
    const now = new Date();
    // Doses more than 2h past due (the auto-missed grace window) are stale —
    // after server downtime they should be marked missed by the hourly cron,
    // not blasted out as a burst of confusing late reminders.
    const staleCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    try {
      if (!(await this.cronLock.claim('dose-reminders', 60_000))) return;
      // Joined against deviceSessions (not users) so a user signed into
      // several devices gets the reminder on all of them, not just whichever
      // device last overwrote a single shared push token.
      const pendingDoses = await this.db
        .select({
          event: schema.doseEvents,
          medication: schema.medications,
          dosageForm: schema.dosageForms,
          device: schema.deviceSessions,
        })
        .from(schema.doseEvents)
        .innerJoin(
          schema.schedules,
          eq(schema.doseEvents.scheduleId, schema.schedules.id),
        )
        .innerJoin(
          schema.dosageForms,
          eq(schema.schedules.dosageFormId, schema.dosageForms.id),
        )
        .innerJoin(
          schema.medications,
          eq(schema.dosageForms.medicationId, schema.medications.id),
        )
        .innerJoin(
          schema.deviceSessions,
          eq(schema.medications.userId, schema.deviceSessions.userId),
        )
        .where(
          and(
            eq(schema.doseEvents.status, 'pending'),
            eq(schema.doseEvents.reminderSent, false),
            eq(schema.schedules.isActive, true),
            // Stopped/finished medications owe nothing. Completing one already
            // clears its upcoming events; this also covers any left behind.
            eq(schema.medications.status, 'active'),
            lte(schema.doseEvents.scheduledFor, now),
            gte(schema.doseEvents.scheduledFor, staleCutoff),
            isNotNull(schema.deviceSessions.expoPushToken),
          ),
        );

      if (pendingDoses.length === 0) {
        return;
      }

      const messages: ExpoPushMessage[] = [];
      const eventIdPerMessage: string[] = [];
      const contexts: DeliveryContext[] = [];

      // The server-side half of the app's master Reminders switch. Quiet hours
      // are deliberately NOT consulted here — a dose scheduled for 03:00 has to
      // alert at 03:00, and a silently dropped reminder is indistinguishable
      // from one that never fired. See quiet-hours.util.
      const prefsByUser = await this.preferencesFor([
        ...new Set(pendingDoses.map((d) => d.medication.userId)),
      ]);

      for (const dose of pendingDoses) {
        if (
          prefsByUser.get(dose.medication.userId)?.doseRemindersEnabled ===
          false
        ) {
          continue;
        }

        const pushToken = dose.device.expoPushToken;
        if (!Expo.isExpoPushToken(pushToken)) {
          this.logger.error(
            `Push token ${pushToken} is not a valid Expo push token`,
          );
          continue;
        }

        messages.push({
          to: pushToken,
          sound: 'default',
          title: `Time to take ${dose.medication.name}`,
          body: `${dose.dosageForm.dosageAmount} ${dose.dosageForm.dosageUnit} of ${dose.dosageForm.name}`,
          data: { eventId: dose.event.id },
          categoryId: 'dose_reminder',
          // Android needs both of these or a dose reminder arrives late and
          // silently: without an explicit channelId it lands on expo's fallback
          // "Miscellaneous" channel instead of the MAX-importance `default`
          // channel the app registers (so no heads-up), and without high
          // priority FCM holds it until the device leaves Doze.
          channelId: 'default',
          priority: 'high',
        });

        eventIdPerMessage.push(dose.event.id);
        contexts.push({
          userId: dose.medication.userId,
          category: 'dose_reminder',
          refId: dose.event.id,
        });
      }

      if (messages.length === 0) return;

      // Only mark events whose ticket actually came back 'ok'; results are
      // index-aligned with messages / eventIdPerMessage. A dose can appear
      // once per device, so dedupe before updating — one delivered ticket is
      // enough to mark the event as reminded.
      const results = await this.sendPush(messages, contexts);
      const sentEventIds = [
        ...new Set(eventIdPerMessage.filter((_, i) => results[i])),
      ];

      // Mark successfully-delivered events so they aren't re-sent. Failed ones
      // stay pending and will be retried on the next cron tick.
      if (sentEventIds.length > 0) {
        await this.db
          .update(schema.doseEvents)
          .set({ reminderSent: true })
          .where(inArray(schema.doseEvents.id, sentEventIds));
      }

      this.logger.log(`Sent ${sentEventIds.length} medication reminders.`);
    } catch (error: any) {
      const code = error?.cause?.code;
      if (code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'XX000') {
        this.logger.warn(
          `Database unavailable during reminder check (${code}). Retrying next minute.`,
        );
      } else {
        this.logger.error(
          `Database error during reminder check: ${error.message || error}`,
        );
      }
    }
  }

  /**
   * Tells a companion when the person they care for has missed a dose.
   *
   * Deliberately its own job rather than a tail on `handleMissedDoseMarking`
   * (schedule.service.ts): keeping them separate means a failed push doesn't
   * lose the alert. `companionAlertSentAt` is stamped only once a message is
   * accepted, so the next hourly run retries whatever is still null.
   *
   * Private medications never reach this query — see `medications.isPrivate`.
   */
  @Cron(CronExpression.EVERY_HOUR)
  @SentryCron('companion-missed-dose-alerts', {
    schedule: { type: 'crontab', value: '0 * * * *' },
    checkinMargin: 15,
    maxRuntime: 15,
    timezone: 'UTC',
  })
  async handleCompanionMissedDoseAlerts() {
    try {
      if (
        !(await this.cronLock.claim('companion-missed-dose-alerts', 3_600_000))
      )
        return;

      const now = new Date();
      const since = new Date(now.getTime() - COMPANION_MISSED_LOOKBACK_MS);

      const missed = await this.db
        .select({
          eventId: schema.doseEvents.id,
          scheduledFor: schema.doseEvents.scheduledFor,
          timezone: schema.schedules.timezone,
          medicationName: schema.medications.name,
          ownerId: schema.medications.userId,
        })
        .from(schema.doseEvents)
        .innerJoin(
          schema.schedules,
          eq(schema.doseEvents.scheduleId, schema.schedules.id),
        )
        .innerJoin(
          schema.dosageForms,
          eq(schema.schedules.dosageFormId, schema.dosageForms.id),
        )
        .innerJoin(
          schema.medications,
          eq(schema.dosageForms.medicationId, schema.medications.id),
        )
        .where(
          and(
            eq(schema.doseEvents.status, 'missed'),
            isNull(schema.doseEvents.companionAlertSentAt),
            gte(schema.doseEvents.scheduledFor, since),
            eq(schema.medications.isPrivate, false),
          ),
        );

      if (missed.length === 0) return;

      const ownerIds = [...new Set(missed.map((m) => m.ownerId))];

      const links = await this.db
        .select({
          ownerId: schema.companionLinks.ownerId,
          companionId: schema.companionLinks.companionId,
        })
        .from(schema.companionLinks)
        .where(
          and(
            inArray(schema.companionLinks.ownerId, ownerIds),
            eq(schema.companionLinks.status, 'active'),
            eq(schema.companionLinks.notifyMissedDose, true),
          ),
        );

      // Owners nobody is watching have nothing to retry, so stamp their events
      // now rather than rescanning them every hour until they age out.
      const watchedOwners = new Set(links.map((l) => l.ownerId));
      const unwatched = missed
        .filter((m) => !watchedOwners.has(m.ownerId))
        .map((m) => m.eventId);
      if (unwatched.length > 0) {
        await this.db
          .update(schema.doseEvents)
          .set({ companionAlertSentAt: new Date() })
          .where(inArray(schema.doseEvents.id, unwatched));
      }

      if (links.length === 0) return;

      const companionIds = [
        ...new Set(
          links.map((l) => l.companionId).filter((id): id is string => !!id),
        ),
      ];

      const devices = await this.db
        .select()
        .from(schema.deviceSessions)
        .where(
          and(
            inArray(schema.deviceSessions.userId, companionIds),
            isNotNull(schema.deviceSessions.expoPushToken),
          ),
        );
      if (devices.length === 0) return;

      const devicesByUser = new Map<string, typeof devices>();
      for (const device of devices) {
        const list = devicesByUser.get(device.userId) ?? [];
        list.push(device);
        devicesByUser.set(device.userId, list);
      }

      const ownerNames = await this.db
        .select({
          userId: schema.profiles.userId,
          fullName: schema.profiles.fullName,
        })
        .from(schema.profiles)
        .where(inArray(schema.profiles.userId, [...watchedOwners]));
      const nameByOwner = new Map(
        ownerNames.map((p) => [p.userId, p.fullName]),
      );

      // Grouped per (companion, owner): someone caring for two people gets one
      // message about each, never a single message mixing both names.
      const groups = new Map<
        string,
        {
          companionId: string;
          ownerId: string;
          items: MissedDoseItem[];
          eventIds: string[];
          timezone: string | null;
        }
      >();

      for (const link of links) {
        if (!link.companionId) continue;
        for (const m of missed) {
          if (m.ownerId !== link.ownerId) continue;
          const key = `${link.companionId}:${link.ownerId}`;
          const group = groups.get(key) ?? {
            companionId: link.companionId,
            ownerId: link.ownerId,
            items: [],
            eventIds: [],
            timezone: m.timezone,
          };
          group.items.push({
            medicationName: m.medicationName,
            scheduledFor: m.scheduledFor,
          });
          group.eventIds.push(m.eventId);
          groups.set(key, group);
        }
      }

      const messages: ExpoPushMessage[] = [];
      const eventIdsPerMessage: string[][] = [];
      const contexts: DeliveryContext[] = [];

      // Ambient channel: honours both the companion's own opt-out and their
      // quiet hours. A missed-dose alert that waits until morning is fine; a
      // missed dose *reminder* would not be.
      const alertPrefs = await this.preferencesFor([
        ...new Set([...groups.values()].map((g) => g.companionId)),
      ]);

      for (const group of groups.values()) {
        if (
          !this.ambientAllowed(
            alertPrefs.get(group.companionId),
            'companion',
            now,
            { respectQuietHours: true },
          )
        ) {
          continue;
        }

        const { title, body } = companionMissedDoseCopy(
          nameByOwner.get(group.ownerId),
          group.items,
          group.timezone,
        );

        for (const device of devicesByUser.get(group.companionId) ?? []) {
          const pushToken = device.expoPushToken;
          if (!Expo.isExpoPushToken(pushToken)) {
            this.logger.error(
              `Push token ${pushToken} is not a valid Expo push token`,
            );
            continue;
          }

          messages.push({
            to: pushToken,
            sound: 'default',
            title,
            body,
            // ownerId drives the deep link into that person's shared view.
            data: { type: 'companion_missed_dose', ownerId: group.ownerId },
            categoryId: 'companion_missed_dose',
            // Its own Android channel, so a companion can mute these without
            // silencing their own dose reminders.
            channelId: 'companion',
          });
          eventIdsPerMessage.push(group.eventIds);
          // Logged against the companion who receives it, not the owner whose
          // dose it was — "why didn't I get an alert?" is asked by the reader.
          contexts.push({
            userId: group.companionId,
            category: 'companion_missed_dose',
            refId: group.eventIds[0] ?? null,
          });
        }
      }

      if (messages.length === 0) return;

      const results = await this.sendPush(messages, contexts);
      const sentEventIds = [
        ...new Set(
          eventIdsPerMessage.flatMap((ids, i) => (results[i] ? ids : [])),
        ),
      ];

      if (sentEventIds.length > 0) {
        await this.db
          .update(schema.doseEvents)
          .set({ companionAlertSentAt: new Date() })
          .where(inArray(schema.doseEvents.id, sentEventIds));
      }

      this.logger.log(
        `Companion missed-dose alerts: ${messages.length} message(s) covering ${sentEventIds.length} dose(s).`,
      );
    } catch (error: any) {
      const code = error?.cause?.code;
      if (code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'XX000') {
        this.logger.warn(
          `Database unavailable during companion alerts (${code}). Retrying next hour.`,
        );
      } else {
        this.logger.error(
          `Error during companion missed-dose alerts: ${error.message || error}`,
        );
      }
    }
  }

  /**
   * Once a day, warn about tracked stock that is about to run out.
   *
   * Predictive rather than threshold-based: the run-out date is projected from the
   * user's actual upcoming doses, so "5 pills left" correctly reads as urgent at
   * four-a-day and relaxed at one-a-day. `refillThreshold` remains the fallback for
   * stock that can't be projected (as-needed schedules materialize no dose events).
   *
   * `refillReminderSentAt` throttles this to at most one push per form per day, and
   * `DosageFormService.update` clears it on restock so the next shortfall alerts
   * again.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  @SentryCron('send-refill-reminders', {
    schedule: { type: 'crontab', value: '0 9 * * *' },
    checkinMargin: 60,
    maxRuntime: 15,
    timezone: 'UTC',
  })
  async handleRefillReminders() {
    this.logger.debug('Checking for medications that need a refill...');

    try {
      if (!(await this.cronLock.claim('refill-reminders', 86_400_000))) return;
      const now = new Date();
      const throttleCutoff = new Date(now.getTime() - 20 * 60 * 60 * 1000);
      const leadCutoff = new Date(
        now.getTime() + REFILL_LEAD_TIME_DAYS * 24 * 60 * 60 * 1000,
      );

      // Candidate forms: stock tracked, medication still being taken, and not
      // already alerted in the last 20h.
      const candidates = await this.db
        .select({
          form: schema.dosageForms,
          medication: schema.medications,
        })
        .from(schema.dosageForms)
        .innerJoin(
          schema.medications,
          eq(schema.dosageForms.medicationId, schema.medications.id),
        )
        .where(
          and(
            isNotNull(schema.dosageForms.quantityOnHand),
            eq(schema.medications.status, 'active'),
            or(
              isNull(schema.dosageForms.refillReminderSentAt),
              lt(schema.dosageForms.refillReminderSentAt, throttleCutoff),
            ),
          ),
        );

      if (candidates.length === 0) return;

      const formIds = candidates.map((c) => c.form.id);

      // Active schedules for those forms. A form whose schedules the user has all
      // muted is skipped entirely — pushing about a medication they've silenced
      // isn't wanted.
      const scheduleRows = await this.db
        .select({
          id: schema.schedules.id,
          dosageFormId: schema.schedules.dosageFormId,
        })
        .from(schema.schedules)
        .where(
          and(
            inArray(schema.schedules.dosageFormId, formIds),
            eq(schema.schedules.isActive, true),
          ),
        );

      const formIdBySchedule = new Map(
        scheduleRows.map((s) => [s.id, s.dosageFormId]),
      );

      // Upcoming doses, ascending, so each form's supply can be walked forward.
      const upcoming = scheduleRows.length
        ? await this.db
            .select({
              scheduleId: schema.doseEvents.scheduleId,
              scheduledFor: schema.doseEvents.scheduledFor,
            })
            .from(schema.doseEvents)
            .where(
              and(
                inArray(
                  schema.doseEvents.scheduleId,
                  scheduleRows.map((s) => s.id),
                ),
                eq(schema.doseEvents.status, 'pending'),
                gte(schema.doseEvents.scheduledFor, now),
              ),
            )
            .orderBy(schema.doseEvents.scheduledFor)
        : [];

      const eventsByForm = new Map<string, { scheduledFor: Date }[]>();
      for (const event of upcoming) {
        const formId = formIdBySchedule.get(event.scheduleId);
        if (!formId) continue;
        const list = eventsByForm.get(formId) ?? [];
        list.push(event);
        eventsByForm.set(formId, list);
      }

      // Decide who needs a reminder before touching push tokens, so the
      // projection runs once per form rather than once per device.
      const dueForms = candidates.filter(({ form }) => {
        const hasActiveSchedule = scheduleRows.some(
          (s) => s.dosageFormId === form.id,
        );
        if (!hasActiveSchedule) return false;

        const events = eventsByForm.get(form.id) ?? [];
        const { runsOutAt } = projectStock(
          form.quantityOnHand!,
          form.dosageAmount,
          events,
        );

        if (runsOutAt) {
          // Warn only while there's still time to act. Once the run-out date has
          // passed the user is already missing doses, and the missed-dose flow
          // covers that — re-nagging daily forever wouldn't help.
          return runsOutAt >= now && runsOutAt <= leadCutoff;
        }
        // No projectable run-out (e.g. as-needed): fall back to the threshold.
        return (
          events.length === 0 &&
          form.quantityOnHand! <= (form.refillThreshold ?? 5)
        );
      });

      if (dueForms.length === 0) return;

      const dueOwnerIds = [
        ...new Set(dueForms.map((f) => f.medication.userId)),
      ];

      // Companions opted into refill alerts get the same warning, so someone
      // can reorder before the person they care for runs out.
      const refillLinks = await this.db
        .select({
          ownerId: schema.companionLinks.ownerId,
          companionId: schema.companionLinks.companionId,
        })
        .from(schema.companionLinks)
        .where(
          and(
            inArray(schema.companionLinks.ownerId, dueOwnerIds),
            eq(schema.companionLinks.status, 'active'),
            eq(schema.companionLinks.notifyRefill, true),
          ),
        );

      const companionsByOwner = new Map<string, string[]>();
      for (const link of refillLinks) {
        if (!link.companionId) continue;
        const list = companionsByOwner.get(link.ownerId) ?? [];
        list.push(link.companionId);
        companionsByOwner.set(link.ownerId, list);
      }

      const ownerNamesForRefill = refillLinks.length
        ? await this.db
            .select({
              userId: schema.profiles.userId,
              fullName: schema.profiles.fullName,
            })
            .from(schema.profiles)
            .where(
              inArray(schema.profiles.userId, [
                ...new Set(refillLinks.map((l) => l.ownerId)),
              ]),
            )
        : [];
      const refillNameByOwner = new Map(
        ownerNamesForRefill.map((p) => [p.userId, p.fullName]),
      );

      const devices = await this.db
        .select()
        .from(schema.deviceSessions)
        .where(
          and(
            inArray(schema.deviceSessions.userId, [
              ...new Set([
                ...dueOwnerIds,
                ...refillLinks
                  .map((l) => l.companionId)
                  .filter((id): id is string => !!id),
              ]),
            ]),
            isNotNull(schema.deviceSessions.expoPushToken),
          ),
        );

      const devicesByUser = new Map<string, typeof devices>();
      for (const device of devices) {
        const list = devicesByUser.get(device.userId) ?? [];
        list.push(device);
        devicesByUser.set(device.userId, list);
      }

      const messages: ExpoPushMessage[] = [];
      const formIdPerMessage: string[] = [];
      const contexts: DeliveryContext[] = [];

      // Both refill legs are ambient: each recipient's own opt-out and quiet
      // hours apply. Owners and companions are looked up together so this is
      // one query regardless of how many people are involved.
      const refillPrefs = await this.preferencesFor([
        ...new Set([
          ...dueForms.map((d) => d.medication.userId),
          ...[...companionsByOwner.values()].flat(),
        ]),
      ]);

      for (const { form, medication } of dueForms) {
        const events = eventsByForm.get(form.id) ?? [];
        const { runsOutAt } = projectStock(
          form.quantityOnHand!,
          form.dosageAmount,
          events,
        );

        const body = runsOutAt
          ? (() => {
              const days = daysUntil(runsOutAt, now);
              if (days === 0)
                return `You'll run out of ${medication.name} today.`;
              if (days === 1)
                return `You'll run out of ${medication.name} tomorrow.`;
              return `You'll run out of ${medication.name} in ${days} days.`;
            })()
          : `${form.quantityOnHand} ${form.dosageUnit} left for ${medication.name}.`;

        for (const device of devicesByUser.get(medication.userId) ?? []) {
          const pushToken = device.expoPushToken;
          if (!Expo.isExpoPushToken(pushToken)) {
            this.logger.error(
              `Push token ${pushToken} is not a valid Expo push token`,
            );
            continue;
          }

          if (
            !this.ambientAllowed(
              refillPrefs.get(medication.userId),
              'refill',
              now,
              { respectQuietHours: false },
            )
          ) {
            continue;
          }

          messages.push({
            to: pushToken,
            sound: 'default',
            title: `Time to refill ${form.name}`,
            body,
            // medicationId is needed too: the app's dosage-form screen takes it
            // as a route param, so tapping through requires both ids.
            data: {
              type: 'refill',
              dosageFormId: form.id,
              medicationId: medication.id,
            },
            categoryId: 'refill_reminder',
            // Android: its own channel, so refills can be tuned down without
            // muting dose reminders (registered in the app's lib/notifications.ts).
            channelId: 'refill',
          });
          formIdPerMessage.push(form.id);
          contexts.push({
            userId: medication.userId,
            category: 'refill_reminder',
            refId: form.id,
          });
        }

        // Same shortfall, phrased about the owner rather than to them. Private
        // medications are excluded: a companion can't see them at all.
        if (!medication.isPrivate) {
          const companionCopy = companionRefillCopy(
            refillNameByOwner.get(medication.userId),
            medication.name,
            runsOutAt ? daysUntil(runsOutAt, now) : null,
          );

          for (const companionId of companionsByOwner.get(medication.userId) ??
            []) {
            if (
              !this.ambientAllowed(
                refillPrefs.get(companionId),
                'companion',
                now,
                { respectQuietHours: false },
              )
            ) {
              continue;
            }

            for (const device of devicesByUser.get(companionId) ?? []) {
              const pushToken = device.expoPushToken;
              if (!Expo.isExpoPushToken(pushToken)) continue;

              messages.push({
                to: pushToken,
                sound: 'default',
                title: companionCopy.title,
                body: companionCopy.body,
                data: {
                  type: 'companion_refill',
                  ownerId: medication.userId,
                },
                categoryId: 'companion_refill',
                channelId: 'companion',
              });
              // Shares the owner's refillReminderSentAt latch: both are sent in
              // the same run, so one throttle covers everyone.
              formIdPerMessage.push(form.id);
              contexts.push({
                userId: companionId,
                category: 'companion_refill',
                refId: form.id,
              });
            }
          }
        }
      }

      if (messages.length === 0) return;

      const results = await this.sendPush(messages, contexts);
      const sentFormIds = [
        ...new Set(formIdPerMessage.filter((_, i) => results[i])),
      ];

      if (sentFormIds.length > 0) {
        await this.db
          .update(schema.dosageForms)
          .set({ refillReminderSentAt: now })
          .where(inArray(schema.dosageForms.id, sentFormIds));
      }

      this.logger.log(
        `Sent refill reminders for ${sentFormIds.length} form(s).`,
      );
    } catch (error: any) {
      const code = error?.cause?.code;
      if (code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'XX000') {
        this.logger.warn(
          `Database unavailable during refill check (${code}). Retrying tomorrow.`,
        );
      } else {
        this.logger.error(
          `Database error during refill check: ${error.message || error}`,
        );
      }
    }
  }

  /**
   * Trim the delivery log.
   *
   * Without this the table grows forever at roughly (users x doses per day)
   * rows, and it is pure diagnostics — nothing downstream reads rows this old.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  @SentryCron('prune-delivery-log', {
    schedule: { type: 'crontab', value: '0 4 * * *' },
    checkinMargin: 60,
    maxRuntime: 10,
    timezone: 'UTC',
  })
  async handleDeliveryLogRetention() {
    try {
      if (!(await this.cronLock.claim('delivery-log-retention', 86_400_000)))
        return;

      const cutoff = new Date(
        Date.now() - DELIVERY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const deleted = await this.db
        .delete(schema.notificationDeliveries)
        .where(lt(schema.notificationDeliveries.sentAt, cutoff))
        .returning({ id: schema.notificationDeliveries.id });

      if (deleted.length > 0) {
        this.logger.log(
          `Pruned ${deleted.length} notification delivery row(s) older than ${DELIVERY_LOG_RETENTION_DAYS} days.`,
        );
      }
    } catch (error: any) {
      const code = error?.cause?.code;
      if (code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'XX000') {
        this.logger.warn(
          `Database unavailable during delivery-log prune (${code}). Retrying tomorrow.`,
        );
      } else {
        this.logger.error(
          `Database error during delivery-log prune: ${error.message || error}`,
        );
      }
    }
  }

  // Shared Expo send: chunks messages, sends them, and returns a boolean[]
  // index-aligned with the input indicating which messages were accepted.
  //
  // "Accepted" is not "delivered" — see handlePushReceipts below.
  //
  // `contexts` is index-aligned with `messages` and exists purely so the
  // delivery log can attribute a ticket to a user and a dose/form. This is the
  // only place a ticket id, its push token and its accept/reject outcome are
  // all in scope, so it's the only place the row can be opened.
  private async sendPush(
    messages: ExpoPushMessage[],
    contexts: DeliveryContext[] = [],
  ): Promise<boolean[]> {
    const results: boolean[] = new Array(messages.length).fill(false);
    const chunks = this.expo.chunkPushNotifications(messages);
    const rows: NewDeliveryRow[] = [];
    let offset = 0;

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        ticketChunk.forEach((ticket: ExpoPushTicket, i) => {
          const ctx = contexts[offset + i];
          if (ticket.status === 'ok') {
            results[offset + i] = true;
            this.queueReceipt(ticket.id, chunk[i].to as string);
            if (ctx) {
              rows.push({
                userId: ctx.userId,
                category: ctx.category,
                refId: ctx.refId ?? null,
                pushToken: chunk[i].to as string,
                ticketId: ticket.id,
                status: 'accepted',
              });
            }
          } else {
            this.logger.error(
              `Push ticket error: ${ticket.message} (${ticket.details?.error ?? 'no detail'})`,
            );
            if (ctx) {
              rows.push({
                userId: ctx.userId,
                category: ctx.category,
                refId: ctx.refId ?? null,
                pushToken: chunk[i].to as string,
                ticketId: null,
                status: 'rejected',
                errorCode: ticket.details?.error ?? 'unknown',
              });
            }
          }
        });
      } catch (error) {
        this.logger.error('Error sending push notifications', error);
      }
      offset += chunk.length;
    }

    await this.recordDeliveries(rows);

    return results;
  }

  /**
   * Write the receipt's verdict back onto the rows sendPush opened.
   *
   * Also swallows its own errors — see recordDeliveries. Tickets with no
   * matching row (sent before this table existed, or by another replica that
   * logged them itself) simply match nothing, which is correct.
   */
  private async resolveDeliveries(
    delivered: string[],
    failed: Map<string, string>,
  ) {
    const resolvedAt = new Date();
    try {
      if (delivered.length > 0) {
        await this.db
          .update(schema.notificationDeliveries)
          .set({ status: 'delivered', resolvedAt })
          .where(inArray(schema.notificationDeliveries.ticketId, delivered));
      }
      // Grouped by error code so each distinct failure is one statement
      // rather than one per ticket.
      const ticketsByError = new Map<string, string[]>();
      for (const [ticketId, code] of failed) {
        const list = ticketsByError.get(code) ?? [];
        list.push(ticketId);
        ticketsByError.set(code, list);
      }
      for (const [code, ticketIds] of ticketsByError) {
        await this.db
          .update(schema.notificationDeliveries)
          .set({ status: 'failed', errorCode: code, resolvedAt })
          .where(inArray(schema.notificationDeliveries.ticketId, ticketIds));
      }
    } catch (error) {
      this.logger.warn('Failed to resolve notification delivery rows', error);
    }
  }

  /**
   * Persist delivery rows. Swallows its own errors on purpose: this is
   * diagnostics, and a logging failure must never take down the reminder that
   * was actually delivered — same principle as EntitlementService.recordUsage.
   */
  private async recordDeliveries(rows: NewDeliveryRow[]) {
    if (rows.length === 0) return;
    try {
      await this.db.insert(schema.notificationDeliveries).values(rows);
    } catch (error) {
      this.logger.warn(
        `Failed to record ${rows.length} notification delivery row(s)`,
        error,
      );
    }
  }

  private queueReceipt(ticketId: string, pushToken: string) {
    if (this.pendingReceipts.length >= MAX_PENDING_RECEIPTS) {
      this.pendingReceipts.shift();
    }
    this.pendingReceipts.push({ ticketId, pushToken, queuedAt: Date.now() });
  }

  /**
   * Ask Expo what actually happened to the pushes it accepted.
   *
   * This exists because a ticket comes back `ok` even when the push later dies
   * at the FCM/APNs hop — a misconfigured credential can drop every Android
   * notification while the send logs read as a clean success. The receipt is
   * the only place that failure is visible, so it gets logged loudly, and a
   * token the platform has disowned is cleared so we stop pushing into a void.
   */
  // Deliberately NOT behind the cron lock: the pending queue is in-memory and
  // per-instance, so every replica must poll receipts for the tickets *it*
  // sent. Running everywhere is correct here, not a double-fire.
  @Cron(CronExpression.EVERY_10_MINUTES)
  @SentryCron('poll-push-receipts', {
    schedule: { type: 'crontab', value: '*/10 * * * *' },
    checkinMargin: 5,
    maxRuntime: 5,
    timezone: 'UTC',
  })
  async handlePushReceipts() {
    if (this.pendingReceipts.length === 0) return;

    const now = Date.now();
    const due = this.pendingReceipts.filter(
      (r) => now - r.queuedAt >= RECEIPT_CHECK_DELAY_MS,
    );
    if (due.length === 0) return;

    // Anything not yet due stays queued; due entries are re-queued below only
    // if Expo doesn't have a receipt for them yet.
    this.pendingReceipts = this.pendingReceipts.filter(
      (r) => now - r.queuedAt < RECEIPT_CHECK_DELAY_MS,
    );

    const tokenByTicket = new Map(due.map((r) => [r.ticketId, r.pushToken]));
    const stillPending: PendingReceipt[] = [];
    const deadTokens = new Set<string>();
    // Terminal outcomes to write back to the delivery log, keyed by ticket.
    const deliveredTickets: string[] = [];
    const failedTickets = new Map<string, string>();

    for (const idChunk of this.expo.chunkPushNotificationReceiptIds(
      due.map((r) => r.ticketId),
    )) {
      let receipts: Awaited<
        ReturnType<typeof this.expo.getPushNotificationReceiptsAsync>
      >;
      try {
        receipts = await this.expo.getPushNotificationReceiptsAsync(idChunk);
      } catch (error) {
        this.logger.error('Error fetching push receipts', error);
        // Transient — put them back so the next tick retries.
        stillPending.push(...due.filter((r) => idChunk.includes(r.ticketId)));
        continue;
      }

      for (const ticketId of idChunk) {
        const receipt = receipts[ticketId];

        if (!receipt) {
          // Not ready yet. Keep waiting, but not forever.
          const entry = due.find((r) => r.ticketId === ticketId);
          if (entry && now - entry.queuedAt < RECEIPT_GIVE_UP_MS) {
            stillPending.push(entry);
          }
          continue;
        }

        if (receipt.status === 'ok') {
          deliveredTickets.push(ticketId);
          continue;
        }

        const detail = receipt.details?.error;
        failedTickets.set(ticketId, detail ?? 'unknown');
        this.logger.error(
          `Push delivery failed (${detail ?? 'unknown'}): ${receipt.message}`,
        );

        if (detail === 'DeviceNotRegistered') {
          const token = tokenByTicket.get(ticketId);
          if (token) deadTokens.add(token);
        }
      }
    }

    this.pendingReceipts.push(...stillPending);

    await this.resolveDeliveries(deliveredTickets, failedTickets);

    // The app re-registers on next launch, so clearing is safe: it costs at
    // most one missed reminder on a device that already wasn't receiving them.
    if (deadTokens.size > 0) {
      await this.db
        .update(schema.deviceSessions)
        .set({ expoPushToken: null })
        .where(inArray(schema.deviceSessions.expoPushToken, [...deadTokens]));
      this.logger.warn(
        `Cleared ${deadTokens.size} push token(s) reported as unregistered.`,
      );
    }
  }
}
