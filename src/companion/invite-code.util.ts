import { createHash, randomInt } from 'crypto';

/**
 * Crockford base32 minus the ambiguous glyphs (I, L, O, U) — invite codes get
 * read aloud and retyped, so 0/O and 1/I/L must not collide.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const INVITE_CODE_LENGTH = 8;

/** Days an unredeemed invite stays valid. */
export const INVITE_TTL_DAYS = 7;

/**
 * ~40 bits of entropy (32^8). Paired with the 5/min throttle on the accept
 * route, guessing one is not a realistic attack; the codes are still hashed at
 * rest so a database leak can't be replayed into access.
 *
 * `randomInt` is the CSPRNG — `Math.random()` here would be a real weakness.
 */
export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/**
 * Normalizes what a human typed before hashing: case-insensitive, and the
 * ambiguous letters fold onto the digits they're mistaken for, so "REM0-1NBX"
 * pasted with a hyphen and an O still matches.
 */
export function normalizeInviteCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

/** Codes are stored only as this digest; the plaintext is shown to the owner once. */
export function hashInviteCode(raw: string): string {
  return createHash('sha256').update(normalizeInviteCode(raw)).digest('hex');
}

export function inviteExpiryFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}
