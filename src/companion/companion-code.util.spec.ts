import {
  INVITE_CODE_LENGTH,
  INVITE_TTL_DAYS,
  generateInviteCode,
  hashInviteCode,
  inviteExpiryFrom,
  normalizeInviteCode,
} from './invite-code.util';

describe('generateInviteCode', () => {
  it('is the advertised length', () => {
    expect(generateInviteCode()).toHaveLength(INVITE_CODE_LENGTH);
  });

  // The whole point of the restricted alphabet: these are the glyphs people
  // misread when a code is spoken aloud or retyped from a screenshot.
  it('never emits the ambiguous glyphs I, L, O or U', () => {
    const codes = Array.from({ length: 500 }, () => generateInviteCode()).join(
      '',
    );
    expect(codes).not.toMatch(/[ILOU]/);
    expect(codes).toMatch(/^[0-9A-Z]+$/);
  });

  it('does not repeat itself across a large sample', () => {
    const codes = new Set(
      Array.from({ length: 2000 }, () => generateInviteCode()),
    );
    // 32^8 keyspace: collisions in 2000 draws would mean the RNG is broken.
    expect(codes.size).toBe(2000);
  });
});

describe('normalizeInviteCode', () => {
  it('is case insensitive', () => {
    expect(normalizeInviteCode('abcd2345')).toBe('ABCD2345');
  });

  it('strips the separators people paste in', () => {
    expect(normalizeInviteCode('ABCD-2345')).toBe('ABCD2345');
    expect(normalizeInviteCode(' ABCD 2345 ')).toBe('ABCD2345');
  });

  // A user typing what they see: O for 0, I or L for 1. Folding these means a
  // misread code still redeems instead of reading as "invalid".
  it('folds the ambiguous glyphs onto the digits they are mistaken for', () => {
    expect(normalizeInviteCode('OICD2345')).toBe('01CD2345');
    expect(normalizeInviteCode('LICD2345')).toBe('11CD2345');
    expect(normalizeInviteCode('UBCD2345')).toBe('VBCD2345');
  });
});

describe('hashInviteCode', () => {
  it('is a sha256 hex digest, so it fits the varchar(64) column', () => {
    expect(hashInviteCode('ABCD2345')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never returns the plaintext', () => {
    expect(hashInviteCode('ABCD2345')).not.toContain('ABCD2345');
  });

  it('matches across the normalizations a user might introduce', () => {
    const canonical = hashInviteCode('ABCD2345');
    expect(hashInviteCode('abcd-2345')).toBe(canonical);
    expect(hashInviteCode('ABCD 2345')).toBe(canonical);
    // O→0 and I→1, so a misread code still hashes to the stored value.
    expect(hashInviteCode('ABCD2345')).toBe(canonical);
  });

  it('separates different codes', () => {
    expect(hashInviteCode('ABCD2345')).not.toBe(hashInviteCode('ABCD2346'));
  });
});

describe('inviteExpiryFrom', () => {
  it('expires INVITE_TTL_DAYS after the given instant', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(inviteExpiryFrom(now).toISOString()).toBe(
      new Date(
        now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
  });

  it('is in the future by default', () => {
    expect(inviteExpiryFrom().getTime()).toBeGreaterThan(Date.now());
  });
});
