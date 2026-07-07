import { Injectable, Inject, Logger } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, gte, lte, gt, inArray } from 'drizzle-orm';
import * as schema from '../db/schema';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import {
  SchedulePayload,
  GenerationWindow,
  computeDoseEventTimes,
  horizonEndFor,
  endOfDayInTz,
} from './schedule.util';

/** Accepts either the root Drizzle client or a transaction handle. */
type DrizzleExecutor =
  | NodePgDatabase<typeof schema>
  | Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

export interface MedicationBounds {
  startDate?: Date | null;
  endDate?: Date | null;
}

export interface ScheduleLike extends SchedulePayload {
  id: string;
  timezone?: string | null;
  isActive?: boolean | null;
  asNeeded?: boolean | null;
}

/**
 * Materializes dose events for schedules over a rolling horizon, bounded by
 * the medication's startDate/endDate. Owns the create / edit / cron-top-up
 * paths so ScheduleService and MedicationService share one implementation
 * without importing each other (their modules would cycle).
 */
@Injectable()
export class DoseEventGeneratorService {
  private readonly logger = new Logger(DoseEventGeneratorService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * The window to materialize: from now (never before the medication's
   * startDate) out to the schedule's horizon, clamped to the end of the
   * medication's endDate as a full calendar day in the schedule's timezone.
   * Returns null when the course is already over or hasn't reached the
   * horizon yet.
   */
  generationWindow(
    schedule: ScheduleLike,
    bounds: MedicationBounds,
    now: Date = new Date(),
  ): GenerationWindow | null {
    const tz = schedule.timezone ?? 'UTC';
    let start = now;
    if (bounds.startDate && bounds.startDate > start) {
      start = bounds.startDate;
    }
    let end = horizonEndFor(schedule, now);
    if (bounds.endDate) {
      const courseEnd = endOfDayInTz(bounds.endDate, tz);
      if (courseEnd < end) end = courseEnd;
    }
    if (end < start) return null;
    return { start, end };
  }

  /**
   * Insert any missing dose events for the schedule inside its window.
   * Idempotent: existing events in the window — whatever their status, so
   * taken doses and snoozed doses are never duplicated — are skipped by exact
   * timestamp. Returns the number of events inserted.
   */
  async generateForSchedule(
    schedule: ScheduleLike,
    bounds: MedicationBounds,
    dbc: DrizzleExecutor = this.db,
  ): Promise<number> {
    if (schedule.asNeeded || schedule.type === 'as_needed') return 0;
    if (schedule.isActive === false) return 0;

    const tz = schedule.timezone ?? 'UTC';
    const window = this.generationWindow(schedule, bounds);
    if (!window) return 0;

    const times = computeDoseEventTimes(schedule, tz, window);
    if (times.length === 0) return 0;

    const existing = await dbc
      .select({ scheduledFor: schema.doseEvents.scheduledFor })
      .from(schema.doseEvents)
      .where(
        and(
          eq(schema.doseEvents.scheduleId, schedule.id),
          gte(schema.doseEvents.scheduledFor, window.start),
          lte(schema.doseEvents.scheduledFor, window.end),
        ),
      );
    const existingMs = new Set(existing.map((e) => e.scheduledFor.getTime()));

    const newTimes = times.filter((t) => !existingMs.has(t.getTime()));
    if (newTimes.length > 0) {
      await dbc.insert(schema.doseEvents).values(
        newTimes.map((time) => ({
          scheduleId: schedule.id,
          scheduledFor: time,
          status: 'pending',
        })),
      );
    }
    return newTimes.length;
  }

  /**
   * Delete future, still-pending events for the given schedules. Taken/missed
   * history is untouched, and snoozed doses (snoozeCount > 0) survive — they
   * represent an already-notified dose the user deferred, which is still owed
   * even if the timing rules change.
   */
  async clearFuturePending(
    scheduleIds: string[],
    dbc: DrizzleExecutor = this.db,
    now: Date = new Date(),
  ): Promise<void> {
    if (scheduleIds.length === 0) return;
    await dbc
      .delete(schema.doseEvents)
      .where(
        and(
          inArray(schema.doseEvents.scheduleId, scheduleIds),
          eq(schema.doseEvents.status, 'pending'),
          gt(schema.doseEvents.scheduledFor, now),
          eq(schema.doseEvents.snoozeCount, 0),
        ),
      );
  }

  /**
   * Rebuild a schedule's future events after its timing rules or its
   * medication's start/end dates changed: drop future pending events, then
   * regenerate (no-op when the schedule is inactive, so deactivating also
   * clears upcoming reminders).
   */
  async regenerateForSchedule(
    schedule: ScheduleLike,
    bounds: MedicationBounds,
    dbc: DrizzleExecutor = this.db,
  ): Promise<number> {
    await this.clearFuturePending([schedule.id], dbc);
    return this.generateForSchedule(schedule, bounds, dbc);
  }
}
