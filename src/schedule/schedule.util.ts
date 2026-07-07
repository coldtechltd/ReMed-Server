/**
 * Pure, dependency-free helpers for computing when a schedule's dose events
 * should occur. Shared by ScheduleService (single-schedule + daily cron) and
 * MedicationService (atomic multi-drug create) so the logic lives in one place.
 */

export interface SchedulePayload {
  type: string;
  intervalValue?: number | null;
  intervalUnit?: string | null;
  specificTimes?: string[] | null;
  daysOfWeek?: string[] | null;
  firstDoseAt?: string | Date | null;
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
      if (!payload.daysOfWeek?.length || payload.daysOfWeek.includes(abbrev)) {
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
        eventTimes.push(new Date(current));
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
