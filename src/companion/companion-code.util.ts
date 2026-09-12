import { randomInt } from 'crypto';

/**
 * Crockford base32 minus the ambiguous glyphs (I, L, O, U) — sharing codes get
 * read aloud and retyped, so 0/O and 1/I/L must not collide.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const COMPANION_CODE_LENGTH = 8;

/**
 * ~40 bits of entropy (32^8). Paired with the 5/min throttle on redemption,
 * guessing one is not a realistic attack: an attacker gets 2,628,000 tries a
 * year against a 1.1-trillion keyspace, and every hit lands them in a list the
 * owner can see and revoke.
 *
 * `randomInt` is the CSPRNG — `Math.random()` here would be a real weakness.
 */
export function generateCompanionCode(): string {
  let code = '';
  for (let i = 0; i < COMPANION_CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/**
 * Normalizes what a human typed before it is compared: case-insensitive, and
 * the ambiguous letters fold onto the digits they're mistaken for, so
 * "rem0-1nbx" pasted with a hyphen and an O still matches.
 *
 * Codes are stored in this same normalized form. The generator never emits
 * I, L, O or U, so a generated code is already its own normalization — that
 * invariant is what makes storage and lookup a plain equality check.
 */
export function normalizeCompanionCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}
