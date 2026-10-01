/**
 * Validation for the timezone and locale the app reports (B12). Pure, so the
 * edge cases are testable without a database — same split as stock.util.ts.
 *
 * Both lean on the ICU data Node ships with, the same source schedule.util.ts
 * uses for its timezone maths, so a zone accepted here is one the rest of the
 * server can actually convert with.
 */

/** True for a zone ICU knows ("Africa/Lagos", "UTC"); false for anything else. */
export function isValidTimeZone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The canonical form of a BCP 47 tag ("en-gb" → "en-GB"), or null if it isn't
 * one. Canonicalising means two phones reporting the same locale in different
 * casing don't look like a change.
 */
export function canonicalLocale(tag: string): string | null {
  if (!tag || tag.length > 35) return null;
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}
