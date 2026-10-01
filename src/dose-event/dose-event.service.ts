import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, lte, gte, and, desc, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import { UpdateDoseEventDto } from './dto/update-dose-event.dto';
import { LogDoseDto } from './dto/log-dose.dto';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { ScheduleService } from '../schedule/schedule.service';
import { dayKeyInTz, zonedTimeToUtc } from '../schedule/schedule.util';
import { consumedUnits } from '../dosage-form/stock.util';
import { summarizeAdherence } from './adherence.util';

@Injectable()
export class DoseEventService {
  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly scheduleService: ScheduleService,
  ) {}

  /**
   * Excludes doses scheduled *after* a medication was stopped.
   *
   * `complete()` deletes them, but rows stopped by an older build (or already
   * flipped to "missed" by the hourly cron, which doesn't filter on medication
   * status) are still in the table. Without this, a medication the user marked
   * completed keeps showing up in the day's dose list and keeps its misses in
   * the adherence numbers. `coalesce` keeps legacy rows with a null
   * `completedAt` visible rather than hiding their whole history.
   */
  /**
   * Extra filter for companion reads: medications the owner marked private are
   * invisible to everyone but the owner. Returns [] for the owner's own reads
   * so the query is byte-for-byte what it was before.
   */
  private privacyFilter(opts?: { excludePrivate?: boolean }) {
    return opts?.excludePrivate
      ? [eq(schema.medications.isPrivate, false)]
      : [];
  }

  /**
   * The zone a read buckets calendar days in (B12).
   *
   * A user's own reads use the zone their device sent, falling back to the one
   * their phone last reported for callers that send none. A companion's read
   * is about someone else's day, so the owner's stored zone wins there: a
   * caregiver in London looking at a parent in Lagos should see the parent's
   * Tuesday, not their own. The request's zone remains the fallback for an
   * owner whose app predates B12 and has stored nothing.
   */
  private async resolveTimezone(
    userId: string,
    requestTz: string | undefined,
    preferStored: boolean,
  ): Promise<string | undefined> {
    if (requestTz && !preferStored) return requestTz;
    const [row] = await this.db
      .select({ timezone: schema.profiles.timezone })
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, userId))
      .limit(1);
    return row?.timezone ?? requestTz;
  }

  private readonly notStoppedBefore = sql`(
    ${schema.medications.status} <> 'completed'
    OR ${schema.doseEvents.scheduledFor} <= coalesce(${schema.medications.completedAt}, ${schema.doseEvents.scheduledFor})
  )`;

  /**
   * Excludes PRN ("as needed") doses from adherence aggregation.
   *
   * A logged PRN dose is a real `taken` row, but it was never *scheduled* — so
   * counting it inflates the adherence rate and the streak, and taking an extra
   * painkiller would make adherence look better than it is. Adherence is only
   * meaningful against doses the user was actually supposed to take.
   *
   * `as_needed` is recorded two ways (the `type` and the `asNeeded` flag) and
   * `asNeeded` is nullable on rows written by older builds, hence the coalesce.
   */
  private readonly scheduledOnly = sql`(
    ${schema.schedules.type} <> 'as_needed'
    AND coalesce(${schema.schedules.asNeeded}, false) = false
  )`;

  async findAllByUser(userId: string) {
    // This requires joining doseEvents -> schedules -> dosageForms -> medications
    // Drizzle query API doesn't support deep nested mapping easily without custom manual mapping,
    // so we'll do an inner join to fetch events strictly belonging to the user
    const results = await this.db
      .select({
        event: schema.doseEvents,
        schedule: schema.schedules,
        dosageForm: schema.dosageForms,
        medication: schema.medications,
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
      .where(eq(schema.medications.userId, userId))
      .orderBy(desc(schema.doseEvents.takenAt));

    return results.map((r) => ({
      ...r.event,
      schedule: r.schedule,
      dosageForm: r.dosageForm,
      medication: r.medication,
    }));
  }

  async getUpcoming(
    userId: string,
    opts?: {
      from?: string;
      days?: number;
      limit?: number;
      tz?: string;
      excludePrivate?: boolean;
      /** Bucket days in the owner's stored zone (companion reads). */
      ownerTimezone?: boolean;
    },
  ) {
    const tz = await this.resolveTimezone(
      userId,
      opts?.tz,
      Boolean(opts?.ownerTimezone),
    );

    // Optional window. Callers that pass nothing (the app's "N remaining"
    // badge) keep the original unbounded behaviour; the widget snapshot passes
    // from/days/limit so it doesn't drag the full 90-day materialization
    // horizon — hundreds of rows with four nested objects each — over the wire.
    const conditions = [
      eq(schema.medications.userId, userId),
      eq(schema.doseEvents.status, 'pending'),
      // Neither of these was applied before. In-app that only skewed a badge
      // count, but a home-screen widget would show a next dose for a paused
      // schedule or a completed course, and its Take button would PATCH it.
      eq(schema.schedules.isActive, true),
      eq(schema.medications.status, 'active'),
      ...this.privacyFilter(opts),
    ];

    if (opts?.from) {
      const bounds = tz ? this.dayBoundsInTz(opts.from, tz) : null;
      let start: Date;
      if (bounds) {
        start = bounds.startOfDay;
      } else {
        start = new Date(opts.from);
        if (Number.isNaN(start.getTime())) {
          throw new BadRequestException('`from` must be a valid date');
        }
        start.setHours(0, 0, 0, 0);
      }
      conditions.push(gte(schema.doseEvents.scheduledFor, start));

      if (opts.days != null) {
        const end = new Date(start);
        end.setDate(end.getDate() + opts.days);
        conditions.push(lte(schema.doseEvents.scheduledFor, end));
      }
    }

    const query = this.db
      .select({
        event: schema.doseEvents,
        schedule: schema.schedules,
        dosageForm: schema.dosageForms,
        medication: schema.medications,
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
      .where(and(...conditions))
      .orderBy(schema.doseEvents.scheduledFor);

    const results = await (opts?.limit ? query.limit(opts.limit) : query);

    return results.map((r) => ({
      ...r.event,
      schedule: r.schedule,
      dosageForm: r.dosageForm,
      medication: r.medication,
    }));
  }

  async findEventsByDate(
    userId: string,
    dateStr: string,
    requestTz?: string,
    opts?: { excludePrivate?: boolean; ownerTimezone?: boolean },
  ) {
    const tz = await this.resolveTimezone(
      userId,
      requestTz,
      Boolean(opts?.ownerTimezone),
    );
    // With a tz, "the day" is the user's calendar day, not the server's —
    // otherwise doses near midnight land on the wrong date in the app.
    let startOfDay: Date;
    let endOfDay: Date;
    const dayBounds = tz ? this.dayBoundsInTz(dateStr, tz) : null;
    if (dayBounds) {
      ({ startOfDay, endOfDay } = dayBounds);
    } else {
      const targetDate = new Date(dateStr);
      startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);
    }

    const results = await this.db
      .select({
        event: schema.doseEvents,
        schedule: schema.schedules,
        dosageForm: schema.dosageForms,
        medication: schema.medications,
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
          eq(schema.medications.userId, userId),
          gte(schema.doseEvents.scheduledFor, startOfDay),
          lte(schema.doseEvents.scheduledFor, endOfDay),
          this.notStoppedBefore,
          ...this.privacyFilter(opts),
        ),
      )
      .orderBy(schema.doseEvents.scheduledFor);

    return results.map((r) => ({
      ...r.event,
      schedule: r.schedule,
      dosageForm: r.dosageForm,
      medication: r.medication,
    }));
  }

  /**
   * UTC bounds of the calendar day `dateStr` (YYYY-MM-DD) in IANA zone `tz`.
   * Returns null for a malformed date or unknown timezone so the caller can
   * fall back to server-local bounds instead of 500ing.
   */
  private dayBoundsInTz(
    dateStr: string,
    tz: string,
  ): { startOfDay: Date; endOfDay: Date } | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    try {
      const startOfDay = zonedTimeToUtc(y, m - 1, d, 0, 0, tz);
      const endOfDay = new Date(
        zonedTimeToUtc(y, m - 1, d, 23, 59, tz).getTime() + 59_999,
      );
      return { startOfDay, endOfDay };
    } catch {
      return null; // invalid IANA timezone
    }
  }

  async getStats(
    userId: string,
    fromStr?: string,
    toStr?: string,
    requestTz?: string,
    opts?: { excludePrivate?: boolean; ownerTimezone?: boolean },
  ) {
    const tz = await this.resolveTimezone(
      userId,
      requestTz,
      Boolean(opts?.ownerTimezone),
    );
    // Default window: last 30 days (inclusive of today). With a tz, both the
    // window bounds and the per-day buckets below use the user's calendar
    // days — server-local bucketing put doses near midnight on the wrong day
    // for almost every user. Falls back to server-local on a bad/missing tz.
    const toBounds = tz
      ? this.dayBoundsInTz(toStr ?? dayKeyInTz(new Date(), tz), tz)
      : null;
    const to = toBounds
      ? toBounds.endOfDay
      : toStr
        ? new Date(toStr)
        : new Date();
    if (!toBounds) to.setHours(23, 59, 59, 999);

    const defaultFromInstant = new Date(
      to.getTime() - 29 * 24 * 60 * 60 * 1000,
    );
    const fromBounds = tz
      ? this.dayBoundsInTz(fromStr ?? dayKeyInTz(defaultFromInstant, tz), tz)
      : null;
    const from = fromBounds
      ? fromBounds.startOfDay
      : fromStr
        ? new Date(fromStr)
        : defaultFromInstant;
    if (!fromBounds) from.setHours(0, 0, 0, 0);

    const rows = await this.db
      .select({
        status: schema.doseEvents.status,
        scheduledFor: schema.doseEvents.scheduledFor,
        takenAmount: schema.doseEvents.takenAmount,
        dosageAmount: schema.dosageForms.dosageAmount,
        medicationName: schema.medications.name,
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
          eq(schema.medications.userId, userId),
          gte(schema.doseEvents.scheduledFor, from),
          lte(schema.doseEvents.scheduledFor, to),
          this.notStoppedBefore,
          this.scheduledOnly,
          ...this.privacyFilter(opts),
        ),
      );

    // YYYY-MM-DD bucket key in the user's timezone (server-local fallback).
    const dayKey = (d: Date) => dayKeyInTz(d, tz);

    // The counting rules, including how skipped and partial doses score, live
    // in adherence.util.ts where they're tested.
    const summary = summarizeAdherence(
      rows.map((r) => ({
        status: r.status,
        dayKey: dayKey(r.scheduledFor),
        medicationName: r.medicationName,
        takenAmount: r.takenAmount,
        dosageAmount: r.dosageAmount,
      })),
      dayKey(new Date()),
    );

    return {
      from: dayKey(from),
      to: dayKey(to),
      ...summary,
    };
  }

  async findOne(id: string, userId: string) {
    const results = await this.db
      .select({
        event: schema.doseEvents,
        schedule: schema.schedules,
        dosageForm: schema.dosageForms,
        medication: schema.medications,
        medUserId: schema.medications.userId,
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
      .where(eq(schema.doseEvents.id, id))
      .limit(1);

    if (results.length === 0) {
      throw new NotFoundException(`Dose event with ID ${id} not found`);
    }

    if (results[0].medUserId !== userId) {
      throw new ForbiddenException(
        `Dose event with ID ${id} does not belong to you`,
      );
    }

    const r = results[0];
    return {
      ...r.event,
      schedule: r.schedule,
      dosageForm: r.dosageForm,
      medication: r.medication,
    };
  }

  /**
   * Log an ad-hoc dose that was actually taken — the write path for
   * as-needed (PRN) medications, whose schedules never materialize dose
   * events. Also works for scheduled forms (an extra dose outside the plan):
   * the event is a record, not a reminder, so it's created already-taken with
   * `reminderSent` set so no cron ever picks it up.
   */
  async logDose(userId: string, dto: LogDoseDto) {
    const takenAt = dto.takenAt ? new Date(dto.takenAt) : new Date();
    // Small clock-skew allowance; anything further ahead is a typo, and a
    // future "taken" would confuse the day ring and stats.
    if (takenAt.getTime() > Date.now() + 5 * 60_000) {
      throw new BadRequestException('takenAt cannot be in the future');
    }

    const [form] = await this.db
      .select({
        dosageForm: schema.dosageForms,
        medication: schema.medications,
      })
      .from(schema.dosageForms)
      .innerJoin(
        schema.medications,
        eq(schema.dosageForms.medicationId, schema.medications.id),
      )
      .where(
        and(
          eq(schema.dosageForms.id, dto.dosageFormId),
          eq(schema.medications.userId, userId),
        ),
      );

    if (!form) {
      throw new NotFoundException(
        `Dosage form with ID ${dto.dosageFormId} not found`,
      );
    }
    if (form.medication.status === 'completed') {
      throw new BadRequestException(
        'This medication has been stopped — restart it to log doses',
      );
    }

    // Attach the event to the form's as-needed schedule when one exists, so
    // PRN logs stay distinguishable from scheduled doses; fall back to any
    // schedule for "extra dose" logs on scheduled forms.
    const formSchedules = await this.db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.dosageFormId, dto.dosageFormId));
    const schedule =
      formSchedules.find((s) => s.type === 'as_needed' || s.asNeeded) ??
      formSchedules[0];
    if (!schedule) {
      throw new BadRequestException(
        'This dosage form has no schedule to log against',
      );
    }

    const [event] = await this.db
      .insert(schema.doseEvents)
      .values({
        ...(dto.clientId ? { id: dto.clientId } : {}),
        scheduleId: schedule.id,
        scheduledFor: takenAt,
        takenAt,
        status: 'taken',
        reminderSent: true,
      })
      .onConflictDoNothing({ target: schema.doseEvents.id })
      .returning();

    if (!event) {
      // Only reachable with a clientId: this log already landed — the app
      // replayed a queued request whose first attempt reached us but whose
      // response didn't make it back. Return the original, and don't debit
      // stock a second time. findOne scopes by user, so an id belonging to
      // someone else is a 404 rather than a disclosure.
      return this.findOne(dto.clientId!, userId);
    }

    // Same stock rule as update(): only forms that track stock, floored at 0.
    if (form.dosageForm.quantityOnHand !== null) {
      await this.db
        .update(schema.dosageForms)
        .set({
          quantityOnHand: sql`GREATEST(${schema.dosageForms.quantityOnHand} - ${form.dosageForm.dosageAmount}, 0)`,
        })
        .where(eq(schema.dosageForms.id, form.dosageForm.id));
    }

    return {
      ...event,
      schedule,
      dosageForm: form.dosageForm,
      medication: form.medication,
    };
  }

  async update(id: string, userId: string, updateDto: UpdateDoseEventDto) {
    const existing = await this.findOne(id, userId);

    const updateData: Record<string, unknown> = {};

    // Snooze: move the dose forward and re-arm the reminder so the
    // every-minute NotificationsService cron re-sends it when it comes due.
    // Resetting scheduledFor also restarts the 2h auto-missed grace window.
    if (updateDto.snoozeMinutes) {
      updateData.scheduledFor = new Date(
        Date.now() + updateDto.snoozeMinutes * 60_000,
      );
      updateData.status = 'pending';
      updateData.reminderSent = false;
      updateData.snoozeCount = sql`${schema.doseEvents.snoozeCount} + 1`;
      // Back to pending means nothing has been taken yet.
      updateData.takenAt = null;
      updateData.takenAmount = null;
    }

    if (updateDto.takenAmount !== undefined && updateDto.status !== 'partial') {
      throw new BadRequestException('takenAmount is only for status=partial');
    }

    if (updateDto.status) {
      updateData.status = updateDto.status;
      if (updateDto.status === 'taken' || updateDto.status === 'partial') {
        // A dose can be logged late or early ("taken at 9:30, not 9:00"), so
        // takenAt is the user's stated time when given. The same small future
        // tolerance as logDose covers clock skew between device and server
        // without letting the user log a dose they haven't taken yet.
        let takenAt = new Date();
        if (updateDto.takenAt) {
          takenAt = new Date(updateDto.takenAt);
          if (takenAt.getTime() > Date.now() + 5 * 60_000) {
            throw new BadRequestException(
              'takenAt cannot be in the future — you can only log a dose you have already taken',
            );
          }
        }
        updateData.takenAt = takenAt;
      } else {
        // Correcting away from "taken" (undo a mis-tap, or flag it missed
        // after all) must not leave a stale takenAt behind.
        updateData.takenAt = null;
      }

      // A partial dose is strictly less than the full one; the full amount
      // is "taken", and stock is integer, so a one-unit dose has no partial.
      if (updateDto.status === 'partial') {
        const full = existing.dosageForm.dosageAmount;
        if (updateDto.takenAmount === undefined) {
          throw new BadRequestException(
            'A partial dose needs takenAmount — how much was actually taken',
          );
        }
        if (updateDto.takenAmount >= full) {
          throw new BadRequestException(
            `A partial dose must be less than the full dose of ${full} ${existing.dosageForm.dosageUnit ?? ''}`.trim(),
          );
        }
        updateData.takenAmount = updateDto.takenAmount;
      } else {
        updateData.takenAmount = null;
      }
    }
    if (updateDto.reminderSent !== undefined) {
      updateData.reminderSent = updateDto.reminderSent;
    }

    if (Object.keys(updateData).length === 0) return existing;

    const [updated] = await this.db
      .update(schema.doseEvents)
      .set(updateData)
      .where(eq(schema.doseEvents.id, id))
      .returning();
    if (!updated) {
      throw new NotFoundException(`Dose event with ID ${id} not found`);
    }

    // Keep stock in step with the *transition*, not the target state, and only
    // for forms that actually track stock.
    //
    // Every correction has to be reversible: taken → pending gives the dose
    // back, taken → partial gives back the part not taken, and a replayed
    // write moves nothing. Moving stock by the difference in consumed units
    // (see consumedUnits) covers all of those, and is what stops a repeated
    // "taken" from double-decrementing. Floor at 0 so we never go negative.
    const tracksStock = existing.dosageForm.quantityOnHand !== null;
    const delta =
      consumedUnits(
        updated.status,
        updated.takenAmount,
        existing.dosageForm.dosageAmount,
      ) -
      consumedUnits(
        existing.status,
        existing.takenAmount,
        existing.dosageForm.dosageAmount,
      );

    if (tracksStock && delta > 0) {
      await this.db
        .update(schema.dosageForms)
        .set({
          quantityOnHand: sql`GREATEST(${schema.dosageForms.quantityOnHand} - ${delta}, 0)`,
        })
        .where(eq(schema.dosageForms.id, existing.dosageForm.id));
    } else if (tracksStock && delta < 0) {
      await this.db
        .update(schema.dosageForms)
        .set({
          quantityOnHand: sql`${schema.dosageForms.quantityOnHand} + ${-delta}`,
        })
        .where(eq(schema.dosageForms.id, existing.dosageForm.id));
    }

    return updated;
  }
}
