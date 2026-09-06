/**
 * Copy for the pushes a companion receives. Pure, so the grouping rules are
 * testable without a database or the Expo SDK — same split as stock.util.ts.
 */

export interface MissedDoseItem {
  medicationName: string;
  scheduledFor: Date;
}

/**
 * Companion notifications are about someone else, so they always lead with a
 * name. Given names only: "Ada missed a dose" reads like a person, "Ada
 * Nwosu missed a dose" reads like a system alert.
 */
export function displayFirstName(fullName: string | null | undefined): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0];
  return first || 'Someone';
}

/** "8:00 PM" in the schedule's own timezone — the owner's clock, not the server's. */
export function formatDoseTime(at: Date, tz?: string | null): string {
  try {
    return at.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz || 'UTC',
    });
  } catch {
    // Unknown IANA zone: fall back rather than throwing inside a cron.
    return at.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    });
  }
}

/**
 * One push per companion per run, not one per dose. A caregiver whose parent
 * missed a morning and an evening dose should get a single summary — six
 * separate buzzes is how people turn the feature off.
 */
export function companionMissedDoseCopy(
  ownerFullName: string | null | undefined,
  items: MissedDoseItem[],
  tz?: string | null,
): { title: string; body: string } {
  const name = displayFirstName(ownerFullName);

  if (items.length === 1) {
    const [item] = items;
    return {
      title: `${name} missed a dose`,
      body: `${item.medicationName} at ${formatDoseTime(item.scheduledFor, tz)}`,
    };
  }

  // De-duplicate names: three missed doses of the same drug is "Metformin",
  // not "Metformin, Metformin, Metformin".
  const names = [...new Set(items.map((i) => i.medicationName))];
  const listed =
    names.length <= 2
      ? names.join(' and ')
      : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;

  return {
    title: `${name} missed ${items.length} doses`,
    body: listed,
  };
}

/** Refill copy, phrased about the owner rather than to them. */
export function companionRefillCopy(
  ownerFullName: string | null | undefined,
  medicationName: string,
  daysLeft: number | null,
): { title: string; body: string } {
  const name = displayFirstName(ownerFullName);
  const when =
    daysLeft === null
      ? `${name} is running low on ${medicationName}.`
      : daysLeft <= 0
        ? `${name} runs out of ${medicationName} today.`
        : daysLeft === 1
          ? `${name} runs out of ${medicationName} tomorrow.`
          : `${name} runs out of ${medicationName} in ${daysLeft} days.`;

  return { title: `${name} needs a refill`, body: when };
}
