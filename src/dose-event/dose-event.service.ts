import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, lte, gte, and, desc, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import { UpdateDoseEventDto } from './dto/update-dose-event.dto';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { ScheduleService } from '../schedule/schedule.service';

@Injectable()
export class DoseEventService {
  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly scheduleService: ScheduleService,
  ) {}

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

  async getUpcoming(userId: string) {
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
          eq(schema.doseEvents.status, 'pending'),
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

  async findEventsByDate(userId: string, dateStr: string) {
    const targetDate = new Date(dateStr);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

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

  async getStats(userId: string, fromStr?: string, toStr?: string) {
    // Default window: last 30 days (inclusive of today).
    const to = toStr ? new Date(toStr) : new Date();
    to.setHours(23, 59, 59, 999);
    const from = fromStr
      ? new Date(fromStr)
      : new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
    from.setHours(0, 0, 0, 0);

    const rows = await this.db
      .select({
        status: schema.doseEvents.status,
        scheduledFor: schema.doseEvents.scheduledFor,
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
        ),
      );

    // Local (server-time) YYYY-MM-DD bucket key for a date.
    const dayKey = (d: Date) => {
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
      return local.toISOString().slice(0, 10);
    };

    let taken = 0;
    let missed = 0;
    let pending = 0;
    const byDayMap = new Map<
      string,
      { taken: number; missed: number; pending: number }
    >();
    const perMedMap = new Map<string, { taken: number; missed: number }>();

    for (const r of rows) {
      const key = dayKey(r.scheduledFor);
      const day = byDayMap.get(key) ?? { taken: 0, missed: 0, pending: 0 };
      const med = perMedMap.get(r.medicationName) ?? { taken: 0, missed: 0 };

      if (r.status === 'taken') {
        taken++;
        day.taken++;
        med.taken++;
      } else if (r.status === 'missed') {
        missed++;
        day.missed++;
        med.missed++;
      } else {
        pending++;
        day.pending++;
      }

      byDayMap.set(key, day);
      perMedMap.set(r.medicationName, med);
    }

    const resolved = taken + missed;
    const adherenceRate = resolved === 0 ? null : taken / resolved;

    const byDay = [...byDayMap.entries()]
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Streaks: a day "counts" if it had at least one taken dose and no missed
    // doses. Walk backwards from today for the current streak; scan all days
    // for the longest run.
    const adherentDays = new Set(
      byDay.filter((d) => d.taken > 0 && d.missed === 0).map((d) => d.date),
    );

    let currentStreak = 0;
    const cursor = new Date();
    cursor.setHours(12, 0, 0, 0);
    // Skip today if it has no resolved doses yet (don't punish a day in progress).
    const todayKey = dayKey(new Date());
    const todayCounts = byDayMap.get(todayKey);
    if (todayCounts && todayCounts.taken === 0 && todayCounts.missed === 0) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (adherentDays.has(dayKey(cursor))) {
      currentStreak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    let longestStreak = 0;
    let run = 0;
    let prev: Date | null = null;
    for (const date of [...adherentDays].sort()) {
      const d = new Date(date);
      if (prev && (d.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000) === 1) {
        run++;
      } else {
        run = 1;
      }
      longestStreak = Math.max(longestStreak, run);
      prev = d;
    }

    return {
      from: dayKey(from),
      to: dayKey(to),
      totals: { taken, missed, pending },
      adherenceRate,
      currentStreak,
      longestStreak,
      byDay,
      perMedication: [...perMedMap.entries()]
        .map(([name, c]) => ({
          name,
          taken: c.taken,
          missed: c.missed,
          adherenceRate:
            c.taken + c.missed === 0 ? null : c.taken / (c.taken + c.missed),
        }))
        .sort((a, b) => b.taken + b.missed - (a.taken + a.missed)),
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
    }

    if (updateDto.status) {
      updateData.status = updateDto.status;
      if (updateDto.status === 'taken') {
        updateData.takenAt = new Date();
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

    // Decrement stock only on a real transition into "taken" (avoid
    // double-counting if the dose was already taken), and only for forms that
    // actually track stock. Floor at 0 so we never go negative.
    if (
      updateDto.status === 'taken' &&
      existing.status !== 'taken' &&
      existing.dosageForm.quantityOnHand !== null
    ) {
      await this.db
        .update(schema.dosageForms)
        .set({
          quantityOnHand: sql`GREATEST(${schema.dosageForms.quantityOnHand} - ${existing.dosageForm.dosageAmount}, 0)`,
        })
        .where(eq(schema.dosageForms.id, existing.dosageForm.id));
    }

    return updated;
  }
}
