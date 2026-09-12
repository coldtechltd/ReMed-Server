import {
  isWithinQuietHours,
  minutesOfDayInTz,
  parseHHMM,
} from './quiet-hours.util';

/** An instant that is `hh:mm` local time in `tz`, on a fixed date. */
const at = (iso: string) => new Date(iso);

describe('parseHHMM', () => {
  it('parses valid times', () => {
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('22:30')).toBe(22 * 60 + 30);
    expect(parseHHMM('7:05')).toBe(7 * 60 + 5);
  });

  it('rejects malformed and out-of-range values', () => {
    for (const bad of ['', null, undefined, '24:00', '12:60', '9', 'ten pm']) {
      expect(parseHHMM(bad as string)).toBeNull();
    }
  });
});

describe('minutesOfDayInTz', () => {
  it('reads the wall clock in the given zone, not the server zone', () => {
    // 2026-01-15T23:30Z is 18:30 in New York (UTC-5 in January).
    expect(
      minutesOfDayInTz(at('2026-01-15T23:30:00Z'), 'America/New_York'),
    ).toBe(18 * 60 + 30);
    expect(minutesOfDayInTz(at('2026-01-15T23:30:00Z'), 'UTC')).toBe(
      23 * 60 + 30,
    );
  });

  it('reports midnight as 0, not 1440', () => {
    expect(minutesOfDayInTz(at('2026-01-15T00:00:00Z'), 'UTC')).toBe(0);
  });
});

describe('isWithinQuietHours', () => {
  const nightly = {
    quietHoursEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    timezone: 'UTC',
  };

  it('is inactive when the toggle is off', () => {
    expect(
      isWithinQuietHours(at('2026-01-15T23:00:00Z'), {
        ...nightly,
        quietHoursEnabled: false,
      }),
    ).toBe(false);
  });

  describe('a window that wraps midnight (the common setting)', () => {
    it.each([
      ['2026-01-15T22:00:00Z', true, 'exactly at the start'],
      ['2026-01-15T23:30:00Z', true, 'late evening'],
      ['2026-01-16T00:30:00Z', true, 'after midnight'],
      ['2026-01-16T06:59:00Z', true, 'a minute before the end'],
      ['2026-01-16T07:00:00Z', false, 'exactly at the end — end is exclusive'],
      ['2026-01-16T12:00:00Z', false, 'midday'],
      ['2026-01-16T21:59:00Z', false, 'a minute before the start'],
    ])('%s -> %s (%s)', (iso, expected) => {
      expect(isWithinQuietHours(at(iso), nightly)).toBe(expected);
    });
  });

  describe('a window inside one day', () => {
    const daytime = {
      quietHoursEnabled: true,
      quietHoursStart: '13:00',
      quietHoursEnd: '14:00',
      timezone: 'UTC',
    };

    it.each([
      ['2026-01-15T12:59:00Z', false],
      ['2026-01-15T13:00:00Z', true],
      ['2026-01-15T13:59:00Z', true],
      ['2026-01-15T14:00:00Z', false],
      ['2026-01-15T23:00:00Z', false],
    ])('%s -> %s', (iso, expected) => {
      expect(isWithinQuietHours(at(iso), daytime)).toBe(expected);
    });
  });

  it('evaluates against the user timezone, not the server', () => {
    const prefs = { ...nightly, timezone: 'America/New_York' };
    // 07:00Z is 02:00 in New York (UTC-5 in January) — still quiet there,
    // while 07:00 in UTC is exactly the exclusive end of the window.
    expect(isWithinQuietHours(at('2026-01-16T07:00:00Z'), prefs)).toBe(true);
    expect(isWithinQuietHours(at('2026-01-16T07:00:00Z'), nightly)).toBe(false);
  });

  it('still lines up on the user clock across a DST change', () => {
    // US DST began 2026-03-08. 03:00Z is 23:00 EST on the 7th (UTC-5) and
    // 23:00 EDT on the 9th (UTC-4 — so 03:00Z is 23:00 the previous day).
    const prefs = { ...nightly, timezone: 'America/New_York' };
    expect(isWithinQuietHours(at('2026-03-08T03:00:00Z'), prefs)).toBe(true);
    expect(isWithinQuietHours(at('2026-03-10T03:00:00Z'), prefs)).toBe(true);
    // 18:00 local is outside quiet hours on both sides of the change.
    expect(isWithinQuietHours(at('2026-03-07T23:00:00Z'), prefs)).toBe(false);
    expect(isWithinQuietHours(at('2026-03-10T22:00:00Z'), prefs)).toBe(false);
  });

  describe('degrades to "not quiet" rather than muting wrongly', () => {
    it.each([
      ['a malformed start', { ...nightly, quietHoursStart: 'nope' }],
      ['a malformed end', { ...nightly, quietHoursEnd: '25:00' }],
      ['a missing start', { ...nightly, quietHoursStart: null }],
      ['an invalid timezone', { ...nightly, timezone: 'Mars/Olympus_Mons' }],
      [
        'a zero-width window',
        { ...nightly, quietHoursStart: '22:00', quietHoursEnd: '22:00' },
      ],
    ])('%s', (_label, prefs) => {
      expect(isWithinQuietHours(at('2026-01-15T23:00:00Z'), prefs)).toBe(false);
    });
  });
});
