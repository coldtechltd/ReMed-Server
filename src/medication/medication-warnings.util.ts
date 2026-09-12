/**
 * Advisory checks run when a user records a new medication.
 *
 * Two things the app already knows but never looked at: the allergies on the
 * user's health profile, and the medications they are already taking. Phase 1
 * is deliberately limited to those two — it flags what the *user themselves*
 * told us, which is a record-keeping statement, not clinical advice.
 *
 * **These are advisory and must never block.** `profiles.allergies` is free
 * text that may be a typo or a note ("mild rash with penicillin as a child"),
 * and a prescriber may knowingly prescribe through a recorded allergy. The
 * caller's job is to show the warning and let the user decide.
 *
 * Real drug-interaction checking is explicitly out of scope and needs a
 * sourced dataset plus a decision about the regulatory surface — the AI's
 * "never advise on interactions" guardrail stays exactly as it is.
 *
 * **Known limitation, and it is a clinically real one:** matching is on names
 * and active ingredients only, with no notion of drug *class*. An allergy
 * recorded as "penicillin" will not flag Amoxicillin, even though they
 * cross-react. Closing that gap means a class taxonomy, i.e. the sourced
 * dataset above. Until then the UI must not imply more coverage than this —
 * the wizard's warning card says plainly that ReMed only compares what the
 * user recorded and cannot check interactions, and that wording is
 * load-bearing.
 */

export type MedicationWarningKind = 'allergy' | 'duplicate';

export interface MedicationWarning {
  kind: MedicationWarningKind;
  /** The recorded allergy term or existing medication name that matched. */
  matched: string;
  /** Present for duplicates, so the client can link to the medication. */
  medicationId?: string;
  message: string;
}

export interface WarningInput {
  /** The name the user just typed. */
  name: string;
  /** Its active ingredient, when the curated list knows it. */
  genericName?: string | null;
  /** The free-text allergies field from the health profile. */
  allergies?: string | null;
  activeMedications?: readonly {
    id: string;
    name: string;
    genericName?: string | null;
  }[];
}

/**
 * Tokens shorter than this are ignored.
 *
 * Without a floor, a two-letter allergy note makes every medication match
 * something. Three is the shortest length that still catches real entries.
 */
const MIN_TOKEN_LENGTH = 3;

/** Lowercase, strip punctuation, collapse whitespace. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split a free-text allergies field into candidate terms.
 *
 * Users write these as "penicillin, sulfa drugs" or "peanuts; penicillin" or
 * one per line, so all three separators are honoured. Two shapes need extra
 * handling because they are what people actually type:
 *
 * - **Parenthetical asides** — "Penicillin (mild rash as a child)". The aside
 *   is stripped, or the whole note becomes one term that matches nothing.
 * - **Qualified terms** — "sulfa drugs", "codeine based painkillers". The drug
 *   leads, so the first word is kept as an additional candidate.
 *
 * That second rule can over-match ("acid reflux" would flag Folic acid). That
 * is the deliberate direction to err in: the warning is advisory and one tap
 * to dismiss, whereas a miss means staying silent about an allergy the user
 * took the trouble to record.
 */
export function parseAllergyTerms(allergies?: string | null): string[] {
  if (!allergies) return [];

  const terms = new Set<string>();
  for (const raw of allergies.replace(/\([^)]*\)/g, ' ').split(/[,;\n]/)) {
    const term = normalize(raw);
    if (term.length < MIN_TOKEN_LENGTH) continue;
    terms.add(term);

    const [firstWord] = term.split(' ');
    if (firstWord !== term && firstWord.length >= MIN_TOKEN_LENGTH) {
      terms.add(firstWord);
    }
  }
  return [...terms];
}

/**
 * Does `haystack` contain `needle` as a whole word or word prefix?
 *
 * Substring matching is what makes naive versions of this feature useless:
 * plain `includes` has "ace" match "Paracetamol", and an allergy to "PABA"
 * match nothing useful while flagging half the formulary. Anchoring to a word
 * boundary keeps "pen" from matching "Paracetamol" while still letting
 * "penicillin" match "Penicillin V" and "amoxicillin/penicillin".
 */
export function matchesTerm(haystack: string, needle: string): boolean {
  if (needle.length < MIN_TOKEN_LENGTH) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s/\\-])${escaped}`, 'i').test(haystack);
}

export function findMedicationWarnings(
  input: WarningInput,
): MedicationWarning[] {
  const warnings: MedicationWarning[] = [];
  const name = normalize(input.name);
  if (!name) return warnings;

  const generic = input.genericName ? normalize(input.genericName) : '';
  // Match against both what they typed and its active ingredient, so an
  // allergy recorded as "paracetamol" still catches someone adding "Panadol".
  const searchable =
    generic && generic !== name ? `${name} / ${generic}` : name;

  for (const term of parseAllergyTerms(input.allergies)) {
    if (matchesTerm(searchable, term)) {
      warnings.push({
        kind: 'allergy',
        matched: term,
        message: `Your health profile lists an allergy to "${term}".`,
      });
    }
  }

  for (const existing of input.activeMedications ?? []) {
    const existingName = normalize(existing.name);
    const existingGeneric = existing.genericName
      ? normalize(existing.genericName)
      : '';

    // Same name, or the same active ingredient under two different names.
    const sameName = existingName === name;
    const sameGeneric = Boolean(
      generic && existingGeneric && generic === existingGeneric,
    );

    if (sameName || sameGeneric) {
      warnings.push({
        kind: 'duplicate',
        matched: existing.name,
        medicationId: existing.id,
        message: sameName
          ? `You already have "${existing.name}" in your medications.`
          : `"${existing.name}" contains the same active ingredient (${existing.genericName}).`,
      });
    }
  }

  return warnings;
}
