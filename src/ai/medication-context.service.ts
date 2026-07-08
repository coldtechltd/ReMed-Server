import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, or, isNull, gte, inArray } from 'drizzle-orm';
import * as schema from '../db/schema';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { localDateParts } from '../schedule/schedule.util';

function formatDate(date: Date, timezone: string): string {
  const { year, month0, day } = localDateParts(date, timezone);
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function describeSchedule(
  schedule: typeof schema.schedules.$inferSelect,
): string {
  if (schedule.asNeeded || schedule.type === 'as_needed')
    return 'as needed (PRN)';
  if (schedule.type === 'interval') {
    return `every ${schedule.intervalValue} ${schedule.intervalUnit}`;
  }
  if (schedule.type === 'specific_times') {
    const times = schedule.specificTimes?.join(', ') ?? '';
    const days = schedule.daysOfWeek?.length
      ? ` on ${schedule.daysOfWeek.join(', ')}`
      : ' daily';
    return `at ${times}${days}`;
  }
  return schedule.type;
}

@Injectable()
export class MedicationContextService {
  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Builds a compact, precomputed summary of the user's active medications —
   * schedule, current stock, and a projected "runs out by" date derived from
   * already-materialized pending dose events — so the model reasons over
   * ready-made facts instead of doing date/rate arithmetic itself.
   */
  async buildContext(userId: string, timezone: string): Promise<string> {
    const now = new Date();

    const medications = await this.db
      .select()
      .from(schema.medications)
      .where(
        and(
          eq(schema.medications.userId, userId),
          or(
            isNull(schema.medications.endDate),
            gte(schema.medications.endDate, now),
          ),
        ),
      );

    if (medications.length === 0) {
      return 'The user currently has no medications on file.';
    }

    const medicationIds = medications.map((m) => m.id);
    const dosageForms = await this.db
      .select()
      .from(schema.dosageForms)
      .where(inArray(schema.dosageForms.medicationId, medicationIds));

    if (dosageForms.length === 0) {
      return 'The user currently has no medications on file.';
    }

    const dosageFormIds = dosageForms.map((f) => f.id);
    const schedules = await this.db
      .select()
      .from(schema.schedules)
      .where(
        and(
          inArray(schema.schedules.dosageFormId, dosageFormIds),
          eq(schema.schedules.isActive, true),
        ),
      );

    const scheduleIds = schedules.map((s) => s.id);
    const pendingEvents = scheduleIds.length
      ? await this.db
          .select()
          .from(schema.doseEvents)
          .where(
            and(
              inArray(schema.doseEvents.scheduleId, scheduleIds),
              eq(schema.doseEvents.status, 'pending'),
            ),
          )
      : [];
    pendingEvents.sort(
      (a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime(),
    );

    const medicationById = new Map(medications.map((m) => [m.id, m]));
    const schedulesByForm = new Map<string, (typeof schedules)[number][]>();
    for (const s of schedules) {
      const list = schedulesByForm.get(s.dosageFormId) ?? [];
      list.push(s);
      schedulesByForm.set(s.dosageFormId, list);
    }
    const eventsByForm = new Map<string, typeof pendingEvents>();
    const scheduleToForm = new Map(
      schedules.map((s) => [s.id, s.dosageFormId]),
    );
    for (const ev of pendingEvents) {
      const formId = scheduleToForm.get(ev.scheduleId);
      if (!formId) continue;
      const list = eventsByForm.get(formId) ?? [];
      list.push(ev);
      eventsByForm.set(formId, list);
    }

    const lines: string[] = [];
    for (const form of dosageForms) {
      const medication = medicationById.get(form.medicationId);
      if (!medication) continue;

      const formSchedules = schedulesByForm.get(form.id) ?? [];
      const scheduleDesc = formSchedules.length
        ? formSchedules.map(describeSchedule).join('; ')
        : 'no active schedule';

      let stockDesc: string;
      if (form.quantityOnHand === null || form.quantityOnHand === undefined) {
        stockDesc = 'stock not tracked';
      } else {
        const events = eventsByForm.get(form.id) ?? [];
        if (events.length === 0) {
          stockDesc = `${form.quantityOnHand} ${form.dosageUnit ?? 'units'} on hand, no upcoming doses scheduled`;
        } else {
          let remaining = form.quantityOnHand;
          let runOutEvent: (typeof events)[number] | null = null;
          for (const ev of events) {
            remaining -= form.dosageAmount;
            if (remaining < 0) {
              runOutEvent = ev;
              break;
            }
          }
          if (runOutEvent) {
            stockDesc = `${form.quantityOnHand} ${form.dosageUnit ?? 'units'} on hand, estimated to run out by ${formatDate(runOutEvent.scheduledFor, timezone)} — refill needed before then`;
          } else {
            const last = events[events.length - 1];
            stockDesc = `${form.quantityOnHand} ${form.dosageUnit ?? 'units'} on hand, sufficient through at least ${formatDate(last.scheduledFor, timezone)}`;
          }
        }
      }

      lines.push(
        `- ${medication.name} — ${form.name} (${form.dosageAmount} ${form.dosageUnit ?? 'units'}, ${scheduleDesc}). ${stockDesc}.`,
      );
    }

    if (lines.length === 0) {
      return 'The user currently has no medications on file.';
    }

    return `User's current medications (as of ${formatDate(now, timezone)}):\n${lines.join('\n')}`;
  }
}
