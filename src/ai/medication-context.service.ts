import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, inArray, asc } from 'drizzle-orm';
import * as schema from '../db/schema';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { localDateParts } from '../schedule/schedule.util';
import { projectStock } from '../dosage-form/stock.util';

/**
 * Ceiling on doses read per form for the stock projection. A very large tracked
 * quantity would otherwise ask for more events than the 90-day horizon holds.
 * Hitting the cap only softens the wording to "sufficient through at least …",
 * which stays truthful.
 */
const MAX_STOCK_PROJECTION_EVENTS = 400;

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
    return `every ${schedule.intervalValue} ${schedule.intervalUnit}${describeCycle(schedule)}`;
  }
  if (schedule.type === 'specific_times') {
    const times = schedule.specificTimes?.join(', ') ?? '';
    const days = schedule.daysOfWeek?.length
      ? ` on ${schedule.daysOfWeek.join(', ')}`
      : ' daily';
    return `at ${times}${days}${describeCycle(schedule)}`;
  }
  return schedule.type;
}

/** " (21 days on, 7 days off)" for a cyclic regimen, else "". */
function describeCycle(
  schedule: Pick<
    typeof schema.schedules.$inferSelect,
    'cycleOnDays' | 'cycleOffDays'
  >,
): string {
  if (!schedule.cycleOnDays || !schedule.cycleOffDays) return '';
  return ` (${schedule.cycleOnDays} days on, ${schedule.cycleOffDays} days off)`;
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
          eq(schema.medications.status, 'active'),
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

    const medicationById = new Map(medications.map((m) => [m.id, m]));
    const schedulesByForm = new Map<string, (typeof schedules)[number][]>();
    for (const s of schedules) {
      const list = schedulesByForm.get(s.dosageFormId) ?? [];
      list.push(s);
      schedulesByForm.set(s.dosageFormId, list);
    }

    const eventsByForm = await this.loadStockProjectionEvents(
      dosageForms,
      schedulesByForm,
    );

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
          const { runsOutAt, coveredThrough } = projectStock(
            form.quantityOnHand,
            form.dosageAmount,
            events,
          );
          if (runsOutAt) {
            stockDesc = `${form.quantityOnHand} ${form.dosageUnit ?? 'units'} on hand, estimated to run out by ${formatDate(runsOutAt, timezone)} — refill needed before then`;
          } else {
            stockDesc = `${form.quantityOnHand} ${form.dosageUnit ?? 'units'} on hand, sufficient through at least ${formatDate(coveredThrough!, timezone)}`;
          }
        }
      }

      const courseDesc =
        medication.type === 'course'
          ? medication.endDate
            ? `treatment course through ${formatDate(medication.endDate, timezone)}`
            : 'treatment course'
          : 'ongoing medication';

      lines.push(
        `- ${medication.name} (${courseDesc}) — ${form.name} (${form.dosageAmount} ${form.dosageUnit ?? 'units'}, ${scheduleDesc}). ${stockDesc}.`,
      );
    }

    if (lines.length === 0) {
      return 'The user currently has no medications on file.';
    }

    return `User's current medications (as of ${formatDate(now, timezone)}):\n${lines.join('\n')}`;
  }

  /**
   * Upcoming pending doses per dosage form, fetched only for forms that
   * actually track stock and only as far as `projectStock` can possibly read.
   *
   * `projectStock` walks doses in order until the supply goes negative, so it
   * never looks past `ceil(quantityOnHand / dosageAmount) + 1` events for a
   * given form. Fetching every pending event for a 90-day horizon — as this
   * did before — pulled hundreds of rows per chat turn to answer a question
   * decided by the first handful.
   */
  private async loadStockProjectionEvents(
    dosageForms: (typeof schema.dosageForms.$inferSelect)[],
    schedulesByForm: Map<string, (typeof schema.schedules.$inferSelect)[]>,
  ): Promise<Map<string, { scheduledFor: Date }[]>> {
    const tracked = dosageForms.filter(
      (form) =>
        form.quantityOnHand !== null &&
        form.quantityOnHand !== undefined &&
        (schedulesByForm.get(form.id)?.length ?? 0) > 0,
    );

    const eventsByForm = new Map<string, { scheduledFor: Date }[]>();
    if (tracked.length === 0) return eventsByForm;

    await Promise.all(
      tracked.map(async (form) => {
        const scheduleIds = schedulesByForm.get(form.id)!.map((s) => s.id);
        // +1 so the dose that tips the balance negative is included; that
        // event is what `runsOutAt` reports.
        const perDose = form.dosageAmount > 0 ? form.dosageAmount : 1;
        const needed = Math.min(
          Math.ceil(form.quantityOnHand! / perDose) + 1,
          MAX_STOCK_PROJECTION_EVENTS,
        );

        const rows = await this.db
          .select({ scheduledFor: schema.doseEvents.scheduledFor })
          .from(schema.doseEvents)
          .where(
            and(
              inArray(schema.doseEvents.scheduleId, scheduleIds),
              eq(schema.doseEvents.status, 'pending'),
            ),
          )
          .orderBy(asc(schema.doseEvents.scheduledFor))
          .limit(needed);

        eventsByForm.set(form.id, rows);
      }),
    );

    return eventsByForm;
  }
}
