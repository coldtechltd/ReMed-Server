/**
 * Stock projection: how long a dosage form's tracked supply will last, derived
 * from already-materialized pending dose events rather than from the schedule
 * definition. Using the events means intervals, specific-times, day-of-week
 * gaps and the medication's end date are all already accounted for.
 *
 * Shared by the AI medication context (which narrates "runs out by …") and the
 * daily refill cron (which pushes a reminder ahead of that date).
 */

/** How far ahead of the projected run-out date the refill reminder fires. */
export const REFILL_LEAD_TIME_DAYS = 5;

export interface StockProjection {
  /** First dose the remaining stock cannot cover, or null if stock outlasts all known doses. */
  runsOutAt: Date | null;
  /** Last dose fully covered by stock, or null if stock can't cover even the first one. */
  coveredThrough: Date | null;
  /** Number of upcoming doses the stock covers. */
  dosesCovered: number;
}

/**
 * Walks the upcoming doses in order, spending `dosageAmount` on each, and reports
 * where the supply gives out.
 *
 * `pendingEvents` must be sorted ascending by `scheduledFor`.
 *
 * Note the boundary: stock landing on exactly 0 counts as covered — the dose that
 * takes the balance negative is the one that can't be taken. This mirrors the
 * original inline implementation in MedicationContextService and is relied upon by
 * its wording, so don't "fix" it to `<= 0`.
 */
export function projectStock(
  quantityOnHand: number,
  dosageAmount: number,
  pendingEvents: readonly { scheduledFor: Date }[],
): StockProjection {
  let remaining = quantityOnHand;
  let dosesCovered = 0;

  for (const event of pendingEvents) {
    remaining -= dosageAmount;
    if (remaining < 0) {
      return {
        runsOutAt: event.scheduledFor,
        coveredThrough:
          dosesCovered > 0
            ? pendingEvents[dosesCovered - 1].scheduledFor
            : null,
        dosesCovered,
      };
    }
    dosesCovered += 1;
  }

  return {
    runsOutAt: null,
    coveredThrough:
      pendingEvents.length > 0
        ? pendingEvents[pendingEvents.length - 1].scheduledFor
        : null,
    dosesCovered,
  };
}

/** Whole days from `now` until `runsOutAt`, floored at 0. */
export function daysUntil(runsOutAt: Date, now: Date): number {
  const ms = runsOutAt.getTime() - now.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Units of stock a dose event has used up, given its status.
 *
 * `DoseEventService.update` moves stock by the *difference* between the
 * before and after values of this, rather than keying on "entering taken" and
 * "leaving taken". A partial dose sits between the two, so every correction
 * (taken → partial, partial → pending, partial 1 → taken) has to hand back or
 * spend exactly the gap, and a replayed write moves nothing at all.
 *
 * `takenAmount` is only read for "partial". A partial row with no amount
 * (which the API never writes) consumes nothing rather than a guess.
 */
export function consumedUnits(
  status: string | null,
  takenAmount: number | null,
  dosageAmount: number,
): number {
  if (status === 'taken') return dosageAmount;
  if (status === 'partial') return takenAmount ?? 0;
  return 0;
}
