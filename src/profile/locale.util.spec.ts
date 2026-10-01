import { canonicalLocale, isValidTimeZone } from './locale.util';

describe('isValidTimeZone', () => {
  it('accepts IANA zones and UTC', () => {
    expect(isValidTimeZone('Africa/Lagos')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  // Stored zones feed every day-boundary calculation, so junk must not land.
  it('rejects unknown zones and empty input', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('canonicalLocale', () => {
  it('normalises casing so the same locale never reads as a change', () => {
    expect(canonicalLocale('en-gb')).toBe('en-GB');
    expect(canonicalLocale('fr')).toBe('fr');
  });

  it('rejects something that is not a language tag', () => {
    expect(canonicalLocale('not a locale!')).toBeNull();
    expect(canonicalLocale('')).toBeNull();
  });
});
