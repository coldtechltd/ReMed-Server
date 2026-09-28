/**
 * Local-reminder lease: the rules for handing dose reminders to the phone.
 *
 * Server push cannot reach a phone with no network, and for a medication app
 * "no signal, no reminder" is the one failure that matters most. So the app
 * mirrors the next stretch of dose events into on-phone notifications, which
 * fire offline. Doing that on top of push would remind every dose twice, so the
 * device then *claims* the events it scheduled, and the reminder cron skips
 * pushing those to that device.
 *
 * The claim is exact rather than time-based: each event id is recorded with the
 * `updatedAt` it had when the phone scheduled it, and a push is skipped only
 * while the event still carries that same version. Anything that changes the
 * dose afterwards — a snooze on another device, an edited schedule, a newly
 * created medication — produces a version the phone does not hold, so the dose
 * falls back to push. The failure mode is therefore a rare duplicate, never a
 * silent miss, and no clock comparison between app, database and phone is
 * involved.
 *
 * Pure functions only, so the rules are testable without a database.
 */

/** How far ahead the phone schedules. Also bounds how stale a claim can get. */
export const LOCAL_REMINDER_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * iOS keeps at most 64 pending local notifications per app and silently drops
 * the rest. Leave headroom for the few the app schedules itself (an offline
 * snooze), since those must not evict a real dose.
 */
export const MAX_LOCAL_REMINDERS = 60;

/** A device's claim: event id → the event's updatedAt (ISO) when scheduled. */
export type LocalReminderClaim = Record<string, string>;

/**
 * Whether this device already has this exact version of the dose scheduled
 * on-phone, so pushing it would be a duplicate.
 */
export function isCoveredLocally(
  claim: LocalReminderClaim | null | undefined,
  event: { id: string; updatedAt: Date },
): boolean {
  const claimed = claim?.[event.id];
  if (!claimed) return false;
  const claimedMs = Date.parse(claimed);
  return !Number.isNaN(claimedMs) && claimedMs === event.updatedAt.getTime();
}

/**
 * Trim a claim to what is safe to store: well-formed ids and timestamps, at
 * most MAX_LOCAL_REMINDERS entries. Events that are not the user's are harmless
 * (the cron only consults a device's claim for its own user's doses) but are
 * dropped here anyway rather than stored.
 */
export function sanitizeClaim(
  entries: { eventId: string; updatedAt: string }[],
  ownedEventIds: ReadonlySet<string>,
): LocalReminderClaim {
  const claim: LocalReminderClaim = {};
  for (const { eventId, updatedAt } of entries.slice(0, MAX_LOCAL_REMINDERS)) {
    if (!ownedEventIds.has(eventId)) continue;
    if (Number.isNaN(Date.parse(updatedAt))) continue;
    claim[eventId] = updatedAt;
  }
  return claim;
}

/**
 * Title and body for a dose reminder. Shared by the push and the local
 * snapshot so a reminder reads the same whichever path delivers it.
 */
export function doseReminderCopy(
  medication: { name: string },
  dosageForm: { name: string; dosageAmount: unknown; dosageUnit: unknown },
): { title: string; body: string } {
  return {
    title: `Time to take ${medication.name}`,
    body: `${dosageForm.dosageAmount} ${dosageForm.dosageUnit} of ${dosageForm.name}`,
  };
}
