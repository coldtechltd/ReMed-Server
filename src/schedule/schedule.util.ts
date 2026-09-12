/**
 * Pure, dependency-free helpers for computing when a schedule's dose events
 * should occur. Shared by ScheduleService (single-schedule + daily cron) and
 * MedicationService (atomic multi-drug create) so the logic lives in one place.
 */

import { BadRequestException } from '@nestjs/common';

export interface SchedulePayload {
  type: string;
  intervalValue?: number | null;
  /** 'minutes' | 'hours' | 'days' | 'weeks' */
  intervalUnit?: string | null;
  specificTimes?: string[] | null;
  daysOfWeek?: string[] | null;
  firstDoseAt?: string | Date | null;
  /**
   * Cyclic regimens: N days on, M days off, repeating — the shape of
   * combined oral contraceptives (21/7), some chemo protocols, and
   * "one week on, one week off" courses. Applies on top of whatever the
   * schedule's own type generates, so a cycle composes with both
   * specific_times and interval, and with daysOfWeek.
   */
  cycleOnDays?: number | null;
  cycleOffDays?: number | null;
  /** Day 1 of the first "on" phase. Falls back to the medication start. */
  cycleAnchorDate?: string | Date | null;
}

/** Inclusive [start, end] range of instants to materialize events for. */
export interface GenerationWindow {
  start: Date;
  end: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead dose events are materialized in the DB. */
export const DEFAULT_HORIZON_DAYS = 90;
/**
 * Minute-grained interval schedules would produce tens of thousands of rows
 * over the full horizon, so their materialized window is capped at 48h — the
 * daily cron keeps it topped up.
 */
export const MINUTE_INTERVAL_HORIZON_MS = 2 * DAY_MS;
/** Hard cap per generation run, whatever the schedule shape. */
export const MAX_EVENTS_PER_GENERATION = 1000;

/**
 * Convert a wall-clock time in a given IANA timezone to the correct UTC
 * instant, accounting for that date's DST offset. Uses the standard
 * toLocaleString offset trick — no external timezone library required
 * (Node ships full ICU data).
 */
export function zonedTimeToUtc(
  year: number,
  month0: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month0, day, hour, minute);
  const asUtc = new Date(
    new Date(utcGuess).toLocaleString('en-US', { timeZone: 'UTC' }),
  ).getTime();
  const asZoned = new Date(
    new Date(utcGuess).toLocaleString('en-US', { timeZone }),
  ).getTime();
  const offset = asUtc - asZoned;
  return new Date(utcGuess + offset);
}

/** The year / month (0-indexed) / day as seen in `timeZone` for an instant. */
export function localDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month0: get('month') - 1, day: get('day') };
}

/** Abbreviated weekday ("Mon", "Tue", …) of an instant as seen in `timeZone`. */
function weekdayAbbrev(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(date);
}

/**
 * YYYY-MM-DD key of the calendar day containing `date`, as seen in `timeZone`.
 * Falls back to the server's local day when the zone is missing or invalid —
 * day bucketing should degrade, not 500.
 */
export function dayKeyInTz(date: Date, timeZone?: string): string {
  if (timeZone) {
    try {
      const p = localDateParts(date, timeZone);
      if (!Number.isNaN(p.year)) {
        const mm = String(p.month0 + 1).padStart(2, '0');
        const dd = String(p.day).padStart(2, '0');
        return `${p.year}-${mm}-${dd}`;
      }
    } catch {
      // invalid IANA timezone — fall through to server-local
    }
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** Last millisecond of the calendar day containing `date`, in `timeZone`. */
export function endOfDayInTz(date: Date, timeZone: string): Date {
  const d = localDateParts(date, timeZone);
  return new Date(
    zonedTimeToUtc(d.year, d.month0, d.day, 23, 59, timeZone).getTime() +
      59_999,
  );
}

/** First millisecond of the calendar day containing `date`, in `timeZone`. */
export function startOfDayInTz(date: Date, timeZone: string): Date {
  const d = localDateParts(date, timeZone);
  return zonedTimeToUtc(d.year, d.month0, d.day, 0, 0, timeZone);
}

/**
 * How far ahead events should be materialized for this schedule, from `now`.
 */
export function horizonEndFor(
  payload: SchedulePayload,
  now: Date = new Date(),
): Date {
  if (payload.type === 'interval' && payload.intervalUnit === 'minutes') {
    return new Date(now.getTime() + MINUTE_INTERVAL_HORIZON_MS);
  }
  return new Date(now.getTime() + DEFAULT_HORIZON_DAYS * DAY_MS);
}

/** The cycle fields, as an independently testable shape. */
export interface CyclePhase {
  cycleOnDays?: number | null;
  cycleOffDays?: number | null;
  cycleAnchorDate?: string | Date | null;
}

/** Does this schedule actually define a cycle? */
export function hasCycle(cycle: CyclePhase): boolean {
  return Boolean(
    cycle.cycleOnDays &&
      cycle.cycleOffDays &&
      cycle.cycleOnDays > 0 &&
      cycle.cycleOffDays > 0,
  );
}

/**
 * Is `instant` inside an "on" phase of a cyclic regimen?
 *
 * The day index is counted in **calendar days in the schedule's timezone**, not
 * by dividing elapsed milliseconds. That distinction is the whole point: a DST
 * transition makes one local day 23 or 25 hours long, so millisecond division
 * would drift the phase by a day twice a year — and for a 21-on/7-off
 * contraceptive that means a pill reminder on the wrong day.
 *
 * Days before the anchor are outside the cycle: a regimen cannot have started
 * before its own first day.
 *
 * Returns true when no cycle is defined, so callers can apply it unconditionally.
 */
export function isWithinCyclePhase(
  instant: Date,
  cycle: CyclePhase,
  timeZone = 'UTC',
): boolean {
  if (!hasCycle(cycle)) return true;

  const anchorRaw = cycle.cycleAnchorDate;
  if (!anchorRaw) return true;
  const anchor = new Date(anchorRaw);
  if (Number.isNaN(anchor.getTime())) return true;

  const tz = timeZone || 'UTC';
  let dayIndex: number;
  try {
    const anchorDay = startOfDayInTz(anchor, tz).getTime();
    const instantDay = startOfDayInTz(instant, tz).getTime();
    // Both are local midnights, so the gap is a whole number of days up to
    // the DST hour; rounding absorbs that without letting the index slip.
    dayIndex = Math.round((instantDay - anchorDay) / DAY_MS);
  } catch {
    // Invalid zone — don't silently suppress doses over a bad tz string.
    return true;
  }

  if (dayIndex < 0) return false;

  const period = (cycle.cycleOnDays ?? 0) + (cycle.cycleOffDays ?? 0);
  return dayIndex % period < (cycle.cycleOnDays ?? 0);
}

/**
 * Compute the dose-event instants for a schedule inside `window`, expressed
 * in absolute UTC. Returns a de-duplicated, capped list. Does not touch the
 * database. Defaults to the next 24h when no window is given.
 */
export function computeDoseEventTimes(
  payload: SchedulePayload,
  timeZone: string = 'UTC',
  window?: GenerationWindow,
): Date[] {
  const tz = timeZone || 'UTC';
  const now = new Date();
  const start = window?.start ?? now;
  const end = window?.end ?? new Date(now.getTime() + DAY_MS);
  if (end < start) return [];

  const eventTimes: Date[] = [];

  if (payload.type === 'specific_times' && payload.specificTimes?.length) {
    // Walk each calendar day of the window as seen in the user's zone,
    // anchored at local noon so adding 24h can't skip/repeat a calendar date
    // across a DST boundary.
    const first = localDateParts(start, tz);
    let dayInstant = zonedTimeToUtc(
      first.year,
      first.month0,
      first.day,
      12,
      0,
      tz,
    );

    // +2 covers partial days at both edges of the window.
    const maxDays = Math.ceil((end.getTime() - start.getTime()) / DAY_MS) + 2;
    for (let i = 0; i < maxDays; i++) {
      const d = localDateParts(dayInstant, tz);
      const dayStart = zonedTimeToUtc(d.year, d.month0, d.day, 0, 0, tz);
      if (dayStart > end) break;

      const abbrev = weekdayAbbrev(dayInstant, tz);
      const inCycle = isWithinCyclePhase(dayStart, payload, tz);
      if (
        inCycle &&
        (!payload.daysOfWeek?.length || payload.daysOfWeek.includes(abbrev))
      ) {
        for (const timeStr of payload.specificTimes) {
          const [hours, minutes] = timeStr.split(':').map(Number);
          const instant = zonedTimeToUtc(
            d.year,
            d.month0,
            d.day,
            hours,
            minutes,
            tz,
          );
          if (instant >= start && instant <= end) {
            eventTimes.push(instant);
          }
        }
      }

      if (eventTimes.length >= MAX_EVENTS_PER_GENERATION) break;
      dayInstant = new Date(dayInstant.getTime() + DAY_MS);
    }
  } else if (payload.type === 'interval' && payload.intervalValue) {
    // firstDoseAt is already an absolute instant, so interval stepping is
    // timezone-agnostic.
    let current = payload.firstDoseAt
      ? new Date(payload.firstDoseAt)
      : new Date(start);

    let msInterval = 0;
    if (payload.intervalUnit === 'hours')
      msInterval = payload.intervalValue * 60 * 60 * 1000;
    else if (payload.intervalUnit === 'minutes')
      msInterval = payload.intervalValue * 60 * 1000;
    else if (payload.intervalUnit === 'days')
      msInterval = payload.intervalValue * DAY_MS;
    else if (payload.intervalUnit === 'weeks')
      msInterval = payload.intervalValue * 7 * DAY_MS;

    if (msInterval > 0) {
      // Fast-forward a past first dose onto the grid at/after the window start,
      // preserving the original alignment (e.g. every 8h from yesterday 09:00
      // keeps firing at 01:00 / 09:00 / 17:00).
      if (current < start) {
        const diff = start.getTime() - current.getTime();
        const count = Math.ceil(diff / msInterval);
        current = new Date(current.getTime() + count * msInterval);
      }
      while (current <= end && eventTimes.length < MAX_EVENTS_PER_GENERATION) {
        // Filter rather than skip-ahead: the interval grid stays anchored to
        // firstDoseAt, so doses resume on their original clock times when the
        // next "on" phase starts instead of drifting by the off-phase length.
        if (isWithinCyclePhase(current, payload, tz)) {
          eventTimes.push(new Date(current));
        }
        current = new Date(current.getTime() + msInterval);
      }
    }
  }

  // De-duplicate within the generated list.
  const seen = new Set<number>();
  return eventTimes
    .filter((t) => {
      const key = t.getTime();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_EVENTS_PER_GENERATION);
}

/**
 * Checks that a schedule payload carries the fields its own `type` requires
 * (interval needs intervalValue+intervalUnit, specific_times needs a
 * non-empty specificTimes array) — shared by ScheduleService.create and the
 * AI medication-creation tool so both paths reject malformed schedules the
 * same way instead of silently generating zero dose events.
 */
export function assertValidScheduleTypeFields(sch: {
  type: string;
  intervalValue?: number | null;
  intervalUnit?: string | null;
  specificTimes?: string[] | null;
  cycleOnDays?: number | null;
  cycleOffDays?: number | null;
}): void {
  if (sch.type === 'interval' && (!sch.intervalValue || !sch.intervalUnit)) {
    throw new BadRequestException(
      'Interval schedule requires intervalValue and intervalUnit',
    );
  }
  if (sch.type === 'specific_times' && !sch.specificTimes?.length) {
    throw new BadRequestException(
      'Specific times schedule requires specificTimes array',
    );
  }

  // A half-specified cycle is the dangerous case: "21 on" with no off-phase
  // would silently generate every day forever, which is exactly the regimen
  // the user was trying to avoid. Reject rather than guess.
  const onDays = sch.cycleOnDays ?? null;
  const offDays = sch.cycleOffDays ?? null;
  if ((onDays === null) !== (offDays === null)) {
    throw new BadRequestException(
      'A cycle needs both cycleOnDays and cycleOffDays',
    );
  }
  if (onDays !== null && offDays !== null) {
    if (onDays < 1 || offDays < 1) {
      throw new BadRequestException(
        'cycleOnDays and cycleOffDays must both be at least 1',
      );
    }
    // Cycles are counted in whole days, so a sub-day interval can't express
    // one — and a minute-grained schedule only materializes 48h ahead anyway.
    if (sch.type === 'interval' && sch.intervalUnit === 'minutes') {
      throw new BadRequestException(
        'Cycles cannot be combined with minute-based intervals',
      );
    }
  }
}
