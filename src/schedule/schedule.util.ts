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

const DAY_MS = 24 * 60 * 60 * 1000;

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
function localDateParts(date: Date, timeZone: string) {
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
 * Compute the dose-event instants for a schedule over the next ~24h, expressed
 * in absolute UTC. Returns a de-duplicated list. Does not touch the database.
 */
export function computeDoseEventTimes(
  payload: SchedulePayload,
  timeZone: string = 'UTC',
  now: Date = new Date(),
): Date[] {
  const tz = timeZone || 'UTC';
  const limit = new Date(now.getTime() + DAY_MS);
  const eventTimes: Date[] = [];

  if (payload.type === 'specific_times' && payload.specificTimes?.length) {
    const today = localDateParts(now, tz);
    const startWindow = zonedTimeToUtc(
      today.year,
      today.month0,
      today.day,
      0,
      0,
      tz,
    );
    // Today and tomorrow (in the user's zone). Anchor at local noon so adding a
    // day can't skip/repeat a calendar date across a DST boundary.
    const noonToday = zonedTimeToUtc(
      today.year,
      today.month0,
      today.day,
      12,
      0,
      tz,
    );

    for (let offset = 0; offset <= 1; offset++) {
      const dayInstant = new Date(noonToday.getTime() + offset * DAY_MS);
      const d = localDateParts(dayInstant, tz);
      const abbrev = weekdayAbbrev(dayInstant, tz);

      if (
        payload.daysOfWeek?.length &&
        !payload.daysOfWeek.includes(abbrev)
      ) {
        continue;
      }

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
        if (instant >= startWindow && instant <= limit) {
          eventTimes.push(instant);
        }
      }
    }
  } else if (payload.type === 'interval' && payload.intervalValue) {
    const today = localDateParts(now, tz);
    const startWindow = zonedTimeToUtc(
      today.year,
      today.month0,
      today.day,
      0,
      0,
      tz,
    );

    // firstDoseAt is already an absolute instant, so interval stepping is
    // timezone-agnostic.
    let current = payload.firstDoseAt
      ? new Date(payload.firstDoseAt)
      : new Date(now);

    let msInterval = 0;
    if (payload.intervalUnit === 'hours')
      msInterval = payload.intervalValue * 60 * 60 * 1000;
    else if (payload.intervalUnit === 'minutes')
      msInterval = payload.intervalValue * 60 * 1000;
    else if (payload.intervalUnit === 'days')
      msInterval = payload.intervalValue * DAY_MS;

    if (msInterval > 0) {
      if (current < startWindow) {
        const diff = startWindow.getTime() - current.getTime();
        const count = Math.ceil(diff / msInterval);
        current = new Date(current.getTime() + count * msInterval);
      }
      while (current <= limit) {
        if (current >= startWindow) eventTimes.push(new Date(current));
        current = new Date(current.getTime() + msInterval);
      }
    }
  }

  // De-duplicate within the generated list.
  const seen = new Set<number>();
  return eventTimes.filter((t) => {
    const key = t.getTime();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
