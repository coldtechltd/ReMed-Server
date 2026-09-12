import {
  COMPANION_CODE_LENGTH,
  generateCompanionCode,
  normalizeCompanionCode,
} from './companion-code.util';

describe('generateCompanionCode', () => {
  it('is the advertised length', () => {
    expect(generateCompanionCode()).toHaveLength(COMPANION_CODE_LENGTH);
  });

  // The whole point of the restricted alphabet: these are the glyphs people
  // misread when a code is spoken aloud or retyped from a screenshot.
  it('never emits the ambiguous glyphs I, L, O or U', () => {
    const codes = Array.from({ length: 500 }, () =>
      generateCompanionCode(),
    ).join('');
    expect(codes).not.toMatch(/[ILOU]/);
    expect(codes).toMatch(/^[0-9A-Z]+$/);
  });

  it('does not repeat itself across a large sample', () => {
    const codes = new Set(
      Array.from({ length: 2000 }, () => generateCompanionCode()),
    );
    // 32^8 keyspace: collisions in 2000 draws would mean the RNG is broken.
    expect(codes.size).toBe(2000);
  });

  // Load-bearing: codes are persisted as generated and looked up by the
  // normalized form of what the user typed. If a generated code were not
  // already normalized, it could never be redeemed.
  it('emits codes that are already their own normalization', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateCompanionCode();
      expect(normalizeCompanionCode(code)).toBe(code);
    }
  });
});

describe('normalizeCompanionCode', () => {
  it('is case insensitive', () => {
    expect(normalizeCompanionCode('abcd2345')).toBe('ABCD2345');
  });

  it('strips the separators people paste in', () => {
    expect(normalizeCompanionCode('ABCD-2345')).toBe('ABCD2345');
    expect(normalizeCompanionCode(' ABCD 2345 ')).toBe('ABCD2345');
  });

  // A user typing what they see: O for 0, I or L for 1. Folding these means a
  // misread code still redeems instead of reading as "invalid".
  it('folds the ambiguous glyphs onto the digits they are mistaken for', () => {
    expect(normalizeCompanionCode('OICD2345')).toBe('01CD2345');
    expect(normalizeCompanionCode('LICD2345')).toBe('11CD2345');
    expect(normalizeCompanionCode('UBCD2345')).toBe('VBCD2345');
  });

  it('is idempotent', () => {
    const once = normalizeCompanionCode('abcd-2345');
    expect(normalizeCompanionCode(once)).toBe(once);
  });
});
