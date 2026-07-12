import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, gte, lte, inArray, isNotNull } from 'drizzle-orm';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import * as schema from '../db/schema';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';

@Injectable()
export class NotificationsService {
  private expo: Expo;
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {
    this.expo = new Expo();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleReminders() {
    this.logger.debug('Checking for pending dose events to send reminders...');
    const now = new Date();
    // Doses more than 2h past due (the auto-missed grace window) are stale —
    // after server downtime they should be marked missed by the hourly cron,
    // not blasted out as a burst of confusing late reminders.
    const staleCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    try {
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

      for (const dose of pendingDoses) {
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
        });

        eventIdPerMessage.push(dose.event.id);
      }

      if (messages.length === 0) return;

      // Only mark events whose ticket actually came back 'ok'; results are
      // index-aligned with messages / eventIdPerMessage. A dose can appear
      // once per device, so dedupe before updating — one delivered ticket is
      // enough to mark the event as reminded.
      const results = await this.sendPush(messages);
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

  // Once a day, alert users whose tracked stock has fallen to or below their
  // refill threshold. lowStockAlertSent prevents repeat alerts every day until
  // they restock (resetting the flag happens in DosageFormService.update).
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleRefillReminders() {
    this.logger.debug('Checking for medications that need a refill...');

    try {
      const lowForms = await this.db
        .select({
          form: schema.dosageForms,
          medication: schema.medications,
          device: schema.deviceSessions,
        })
        .from(schema.dosageForms)
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
            isNotNull(schema.dosageForms.quantityOnHand),
            eq(schema.dosageForms.lowStockAlertSent, false),
            lte(
              schema.dosageForms.quantityOnHand,
              schema.dosageForms.refillThreshold,
            ),
            isNotNull(schema.deviceSessions.expoPushToken),
          ),
        );

      if (lowForms.length === 0) return;

      const messages: ExpoPushMessage[] = [];
      const formIdPerMessage: string[] = [];

      for (const row of lowForms) {
        const pushToken = row.device.expoPushToken;
        if (!Expo.isExpoPushToken(pushToken)) {
          this.logger.error(
            `Push token ${pushToken} is not a valid Expo push token`,
          );
          continue;
        }

        messages.push({
          to: pushToken,
          sound: 'default',
          title: `Running low on ${row.form.name}`,
          body: `${row.form.quantityOnHand} ${row.form.dosageUnit} left for ${row.medication.name}. Time to refill.`,
          data: { dosageFormId: row.form.id, type: 'refill' },
        });
        formIdPerMessage.push(row.form.id);
      }

      if (messages.length === 0) return;

      const results = await this.sendPush(messages);
      const sentFormIds = [
        ...new Set(formIdPerMessage.filter((_, i) => results[i])),
      ];

      if (sentFormIds.length > 0) {
        await this.db
          .update(schema.dosageForms)
          .set({ lowStockAlertSent: true })
          .where(inArray(schema.dosageForms.id, sentFormIds));
      }

      this.logger.log(`Sent ${sentFormIds.length} refill reminders.`);
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

  // Shared Expo send: chunks messages, sends them, and returns a boolean[]
  // index-aligned with the input indicating which messages were accepted.
  private async sendPush(messages: ExpoPushMessage[]): Promise<boolean[]> {
    const results: boolean[] = new Array(messages.length).fill(false);
    const chunks = this.expo.chunkPushNotifications(messages);
    let offset = 0;

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        ticketChunk.forEach((ticket: ExpoPushTicket, i) => {
          if (ticket.status === 'ok') {
            results[offset + i] = true;
          } else {
            this.logger.error(`Push ticket error: ${ticket.message}`);
          }
        });
      } catch (error) {
        this.logger.error('Error sending push notifications', error);
      }
      offset += chunk.length;
    }

    return results;
  }
}
