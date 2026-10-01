/**
 * Adherence maths behind `GET /dose-event/stats`. Pure, so the counting rules
 * are testable without a database — same split as stock.util.ts.
 *
 * The five statuses are counted differently, and deliberately so:
 *
 * - **taken** is one dose's worth of adherence.
 * - **partial** is the fraction actually taken (1 of 2 tablets = half a dose).
 * - **missed** is a scheduled dose nobody logged. It counts against the rate
 *   and ends a streak.
 * - **skipped** is the user choosing not to take it, often on a prescriber's
 *   say-so ("hold it the morning of the procedure"). It is left out of the
 *   rate and does not end a streak. Before this status existed the app's Skip
 *   button wrote "missed", so a doctor-advised pause read as forgetfulness.
 *   The count is still reported everywhere the other counts are, so a skip is
 *   never hidden, only not scored.
 * - **pending** hasn't happened yet and isn't scored.
 */

export interface AdherenceRow {
  status: string | null;
  /** YYYY-MM-DD of the scheduled time, in the user's timezone. */
  dayKey: string;
  medicationName: string;
  takenAmount: number | null;
  dosageAmount: number;
}

export interface DoseCounts {
  taken: number;
  partial: number;
  skipped: number;
  missed: number;
  pending: number;
}

/** How a finished (or in-progress) day bears on a streak. */
export type DayOutcome = 'adherent' | 'broken' | 'neutral' | 'open';

const emptyCounts = (): DoseCounts => ({
  taken: 0,
  partial: 0,
  skipped: 0,
  missed: 0,
  pending: 0,
});

/** Unknown statuses fall into pending, as they did before these were split. */
function bucketFor(status: string | null): keyof DoseCounts {
  switch (status) {
    case 'taken':
    case 'partial':
    case 'skipped':
    case 'missed':
      return status;
    default:
      return 'pending';
  }
}

/** How much of one dose a row is worth toward the rate, from 0 to 1. */
export function doseCredit(row: {
  status: string | null;
  takenAmount: number | null;
  dosageAmount: number;
}): number {
  if (row.status === 'taken') return 1;
  if (row.status !== 'partial' || !row.takenAmount || row.dosageAmount <= 0) {
    return 0;
  }
  return Math.min(Math.max(row.takenAmount / row.dosageAmount, 0), 1);
}

/** Skipped and pending doses are outside the denominator. */
function rate(credit: number, counts: DoseCounts): number | null {
  const scored = counts.taken + counts.partial + counts.missed;
  return scored === 0 ? null : credit / scored;
}

/**
 * A day with any missed dose breaks a streak, and a day with anything taken
 * (in full or in part) extends it. A day where everything was skipped is
 * neutral: the streak carries through it without growing. Anything else is
 * a day with nothing resolved yet.
 */
export function classifyDay(c: DoseCounts): DayOutcome {
  if (c.missed > 0) return 'broken';
  if (c.taken + c.partial > 0) return 'adherent';
  if (c.skipped > 0 && c.pending === 0) return 'neutral';
  return 'open';
}

/** The calendar day before a YYYY-MM-DD key. Pure date maths, so no DST. */
export function previousDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * Consecutive adherent days ending today. Today is still in progress, so it
 * adds to the streak if it's already adherent and ends it if a dose was
 * missed, but a day with nothing resolved yet doesn't reset it.
 */
export function currentStreak(
  byDay: ReadonlyMap<string, DoseCounts>,
  todayKey: string,
): number {
  const today = classifyDay(byDay.get(todayKey) ?? emptyCounts());
  if (today === 'broken') return 0;

  let streak = today === 'adherent' ? 1 : 0;
  for (let key = previousDayKey(todayKey); ; key = previousDayKey(key)) {
    const counts = byDay.get(key);
    if (!counts) break;
    const outcome = classifyDay(counts);
    if (outcome === 'adherent') streak++;
    else if (outcome !== 'neutral') break;
  }
  return streak;
}

/** Longest run of adherent days in the window. `days` must be sorted ascending. */
export function longestStreak(
  days: readonly { date: string; counts: DoseCounts }[],
): number {
  let longest = 0;
  let run = 0;
  let prev: string | null = null;

  for (const { date, counts } of days) {
    // A calendar day with no doses at all ends the run, as it always has.
    if (prev !== null && previousDayKey(date) !== prev) run = 0;
    const outcome = classifyDay(counts);
    if (outcome === 'adherent') {
      run++;
      longest = Math.max(longest, run);
    } else if (outcome !== 'neutral') {
      run = 0;
    }
    prev = date;
  }
  return longest;
}

export function summarizeAdherence(
  rows: readonly AdherenceRow[],
  todayKey: string,
) {
  const totals = emptyCounts();
  let credit = 0;
  const byDayMap = new Map<string, DoseCounts>();
  const perMedMap = new Map<string, { counts: DoseCounts; credit: number }>();

  for (const r of rows) {
    const bucket = bucketFor(r.status);
    const day = byDayMap.get(r.dayKey) ?? emptyCounts();
    const med = perMedMap.get(r.medicationName) ?? {
      counts: emptyCounts(),
      credit: 0,
    };
    const c = doseCredit(r);

    totals[bucket]++;
    day[bucket]++;
    med.counts[bucket]++;
    credit += c;
    med.credit += c;

    byDayMap.set(r.dayKey, day);
    perMedMap.set(r.medicationName, med);
  }

  const days = [...byDayMap.entries()]
    .map(([date, counts]) => ({ date, counts }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totals,
    adherenceRate: rate(credit, totals),
    currentStreak: currentStreak(byDayMap, todayKey),
    longestStreak: longestStreak(days),
    byDay: days.map(({ date, counts }) => ({ date, ...counts })),
    perMedication: [...perMedMap.entries()]
      .map(([name, { counts, credit: medCredit }]) => ({
        name,
        taken: counts.taken,
        partial: counts.partial,
        skipped: counts.skipped,
        missed: counts.missed,
        adherenceRate: rate(medCredit, counts),
      }))
      .sort(
        (a, b) =>
          b.taken +
          b.partial +
          b.skipped +
          b.missed -
          (a.taken + a.partial + a.skipped + a.missed),
      ),
  };
}
