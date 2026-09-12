/**
 * Quiet-hours evaluation.
 *
 * Pure and dependency-free so the wrap-around and timezone cases are testable
 * without a database or a clock, the same way schedule.util and stock.util are.
 *
 * **Dose reminders deliberately ignore quiet hours.** A medication app that
 * silently drops a reminder because it is 23:10 has failed at its one job, and
 * the user cannot tell a suppressed reminder from one that never fired. Quiet
 * hours apply to the ambient channels — refill and companion alerts — where a
 * few hours' delay costs nothing. See NotificationsService.
 */

import { localDateParts } from '../schedule/schedule.util';

/** Minutes since local midnight, or null if the string isn't "HH:MM". */
export function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Minutes since midnight of an instant, as seen in `timeZone`. */
export function minutesOfDayInTz(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  // 24:00 is a legal formatToParts result for midnight in some locales/zones.
  const hour = get('hour') % 24;
  return hour * 60 + get('minute');
}

export interface QuietHours {
  quietHoursEnabled?: boolean | null;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  timezone?: string | null;
}

/**
 * Is `now` inside the user's quiet hours?
 *
 * Handles the normal case (13:00–14:00) and the wrap-around one (22:00–07:00),
 * which is what almost every user actually sets. Start == end is treated as
 * "no quiet hours" rather than "all day": a zero-width window is far more
 * likely to be a half-finished setting than a request for total silence.
 *
 * Returns false on anything malformed — an unparseable preference must not be
 * able to mute a notification.
 */
export function isWithinQuietHours(
  now: Date,
  prefs: QuietHours,
  fallbackTimeZone = 'UTC',
): boolean {
  if (!prefs.quietHoursEnabled) return false;

  const start = parseHHMM(prefs.quietHoursStart);
  const end = parseHHMM(prefs.quietHoursEnd);
  if (start === null || end === null || start === end) return false;

  const zone = prefs.timezone || fallbackTimeZone;
  let current: number;
  try {
    // Probe the zone first: an invalid IANA name throws here rather than
    // silently resolving to UTC and muting at the wrong time of day.
    const probe = localDateParts(now, zone);
    if (Number.isNaN(probe.year)) return false;
    current = minutesOfDayInTz(now, zone);
  } catch {
    return false;
  }

  return start < end
    ? current >= start && current < end
    : // Wraps midnight: inside if after the start OR before the end.
      current >= start || current < end;
}
