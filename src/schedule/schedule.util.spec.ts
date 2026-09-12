import {
  assertValidScheduleTypeFields,
  computeDoseEventTimes,
  endOfDayInTz,
  startOfDayInTz,
  hasCycle,
  horizonEndFor,
  isWithinCyclePhase,
  MAX_EVENTS_PER_GENERATION,
  DEFAULT_HORIZON_DAYS,
} from './schedule.util';
import { dayKeyInTz } from './schedule.util';
import { DoseEventGeneratorService } from './dose-event-generator.service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('computeDoseEventTimes', () => {
  describe('interval schedules', () => {
    const payload = {
      type: 'interval',
      intervalValue: 8,
      intervalUnit: 'hours',
    };

    it('fast-forwards a past firstDoseAt onto the grid, preserving alignment', () => {
      const firstDose = new Date('2026-07-05T09:00:00Z');
      const start = new Date('2026-07-06T15:00:00Z');
      const end = new Date('2026-07-07T15:00:00Z');
      const times = computeDoseEventTimes(
        { ...payload, firstDoseAt: firstDose },
        'UTC',
        { start, end },
      );
      // Grid from 07-05 09:00 every 8h: ...07-06 09:00, 17:00, 07-07 01:00, 09:00...
      expect(times[0].toISOString()).toBe('2026-07-06T17:00:00.000Z');
      expect(times.map((t) => t.toISOString())).toEqual([
        '2026-07-06T17:00:00.000Z',
        '2026-07-07T01:00:00.000Z',
        '2026-07-07T09:00:00.000Z',
      ]);
    });

    it('generates across a long horizon for daily intervals', () => {
      const start = new Date('2026-07-06T08:00:00Z');
      const end = new Date(start.getTime() + 90 * DAY);
      const times = computeDoseEventTimes(
        {
          type: 'interval',
          intervalValue: 1,
          intervalUnit: 'days',
          firstDoseAt: start,
        },
        'UTC',
        { start, end },
      );
      expect(times.length).toBe(91); // day 0 through day 90 inclusive
      expect(times[90].toISOString()).toBe(end.toISOString());
    });

    it('starts at the window start when there is no firstDoseAt', () => {
      const start = new Date('2026-07-06T10:30:00Z');
      const end = new Date(start.getTime() + DAY);
      const times = computeDoseEventTimes(payload, 'UTC', { start, end });
      expect(times[0].toISOString()).toBe(start.toISOString());
      expect(times.length).toBe(4);
    });

    it('caps runaway minute-grained schedules', () => {
      const start = new Date('2026-07-06T00:00:00Z');
      const end = new Date(start.getTime() + 90 * DAY);
      const times = computeDoseEventTimes(
        {
          type: 'interval',
          intervalValue: 5,
          intervalUnit: 'minutes',
          firstDoseAt: start,
        },
        'UTC',
        { start, end },
      );
      expect(times.length).toBe(MAX_EVENTS_PER_GENERATION);
    });

    it('returns nothing when the window is inverted (course already over)', () => {
      const start = new Date('2026-07-06T10:00:00Z');
      const end = new Date('2026-07-01T00:00:00Z');
      expect(computeDoseEventTimes(payload, 'UTC', { start, end })).toEqual([]);
    });
  });

  describe('specific_times schedules', () => {
    const payload = {
      type: 'specific_times',
      specificTimes: ['08:00', '20:00'],
    };

    it('excludes times earlier than the window start (no stale same-day doses)', () => {
      // Created at 12:00 Lagos: today's 08:00 already passed, 20:00 has not.
      const start = new Date('2026-07-06T11:00:00Z'); // 12:00 in Lagos (UTC+1)
      const end = new Date(start.getTime() + DAY);
      const times = computeDoseEventTimes(payload, 'Africa/Lagos', {
        start,
        end,
      });
      expect(times.map((t) => t.toISOString())).toEqual([
        '2026-07-06T19:00:00.000Z', // today 20:00 Lagos
        '2026-07-07T07:00:00.000Z', // tomorrow 08:00 Lagos
      ]);
    });

    it('walks every calendar day of a long window', () => {
      const start = new Date('2026-07-06T00:00:00Z');
      const end = new Date(start.getTime() + 30 * DAY);
      const times = computeDoseEventTimes(payload, 'UTC', { start, end });
      // 30 full days × 2 doses; the 31st day's doses fall past the midnight end.
      expect(times.length).toBe(60);
      expect(times[0].toISOString()).toBe('2026-07-06T08:00:00.000Z');
    });

    it('respects daysOfWeek', () => {
      // 2026-07-06 is a Monday.
      const start = new Date('2026-07-06T00:00:00Z');
      const end = new Date(start.getTime() + 8 * DAY);
      const times = computeDoseEventTimes(
        { ...payload, specificTimes: ['09:00'], daysOfWeek: ['Mon', 'Wed'] },
        'UTC',
        { start, end },
      );
      expect(times.map((t) => t.toISOString())).toEqual([
        '2026-07-06T09:00:00.000Z', // Mon
        '2026-07-08T09:00:00.000Z', // Wed
        '2026-07-13T09:00:00.000Z', // next Mon
      ]);
    });
  });

  it('generates nothing for as_needed schedules', () => {
    const start = new Date('2026-07-06T00:00:00Z');
    expect(
      computeDoseEventTimes({ type: 'as_needed' }, 'UTC', {
        start,
        end: new Date(start.getTime() + DAY),
      }),
    ).toEqual([]);
  });
});

describe('day-bound helpers', () => {
  it('endOfDayInTz returns the last ms of the local calendar day', () => {
    const instant = new Date('2026-07-06T00:00:00Z'); // 01:00 Jul 6 in Lagos
    expect(endOfDayInTz(instant, 'Africa/Lagos').toISOString()).toBe(
      '2026-07-06T22:59:59.999Z',
    );
  });

  it('startOfDayInTz returns local midnight', () => {
    const instant = new Date('2026-07-06T12:00:00Z');
    expect(startOfDayInTz(instant, 'Africa/Lagos').toISOString()).toBe(
      '2026-07-05T23:00:00.000Z',
    );
  });
});

describe('horizonEndFor', () => {
  const now = new Date('2026-07-06T00:00:00Z');

  it('uses the default horizon for normal schedules', () => {
    expect(
      horizonEndFor({ type: 'specific_times' }, now).getTime() - now.getTime(),
    ).toBe(DEFAULT_HORIZON_DAYS * DAY);
  });

  it('caps minute-grained interval schedules at 48h', () => {
    expect(
      horizonEndFor(
        { type: 'interval', intervalUnit: 'minutes', intervalValue: 5 },
        now,
      ).getTime() - now.getTime(),
    ).toBe(2 * DAY);
  });
});

describe('DoseEventGeneratorService.generationWindow', () => {
  const generator = new DoseEventGeneratorService(null as never);
  const now = new Date('2026-07-06T10:00:00Z');
  const schedule = {
    id: 's1',
    type: 'specific_times',
    specificTimes: ['08:00'],
    timezone: 'Africa/Lagos',
  };

  it('runs from now to the horizon when unbounded', () => {
    const w = generator.generationWindow(schedule, {}, now);
    expect(w?.start).toEqual(now);
    expect(w?.end.getTime()).toBe(now.getTime() + DEFAULT_HORIZON_DAYS * DAY);
  });

  it('does not start before a future medication startDate', () => {
    const startDate = new Date('2026-07-10T00:00:00Z');
    const w = generator.generationWindow(schedule, { startDate }, now);
    expect(w?.start).toEqual(startDate);
  });

  it('clamps to the end of the endDate day in the schedule timezone', () => {
    const endDate = new Date('2026-07-08T00:00:00Z');
    const w = generator.generationWindow(schedule, { endDate }, now);
    expect(w?.end.toISOString()).toBe('2026-07-08T22:59:59.999Z');
  });

  it('returns null when the course is already over', () => {
    const endDate = new Date('2026-07-01T00:00:00Z');
    expect(generator.generationWindow(schedule, { endDate }, now)).toBeNull();
  });
});

describe('dayKeyInTz', () => {
  // 2026-03-15T03:30Z: still March 14 in New York (UTC-4), already
  // March 15 in Tokyo (UTC+9).
  const instant = new Date('2026-03-15T03:30:00Z');

  it('buckets an instant into the calendar day of the given zone', () => {
    expect(dayKeyInTz(instant, 'America/New_York')).toBe('2026-03-14');
    expect(dayKeyInTz(instant, 'Asia/Tokyo')).toBe('2026-03-15');
    expect(dayKeyInTz(instant, 'UTC')).toBe('2026-03-15');
  });

  it('falls back to the server-local day for a bad or missing zone', () => {
    const local = new Date(
      instant.getTime() - instant.getTimezoneOffset() * 60_000,
    )
      .toISOString()
      .slice(0, 10);
    expect(dayKeyInTz(instant, 'Not/AZone')).toBe(local);
    expect(dayKeyInTz(instant)).toBe(local);
  });
});

describe('cyclic regimens (B11)', () => {
  // 21 days on, 7 off — a combined oral contraceptive, and the case this
  // feature exists for.
  const cycle = {
    cycleOnDays: 21,
    cycleOffDays: 7,
    cycleAnchorDate: '2026-01-01T00:00:00Z',
  };

  describe('hasCycle', () => {
    it('needs both halves to be a cycle', () => {
      expect(hasCycle(cycle)).toBe(true);
      expect(hasCycle({ cycleOnDays: 21, cycleOffDays: null })).toBe(false);
      expect(hasCycle({ cycleOnDays: null, cycleOffDays: 7 })).toBe(false);
      expect(hasCycle({})).toBe(false);
      expect(hasCycle({ cycleOnDays: 0, cycleOffDays: 7 })).toBe(false);
    });
  });

  describe('isWithinCyclePhase', () => {
    const on = (iso: string) => isWithinCyclePhase(new Date(iso), cycle, 'UTC');

    it('covers the whole on-phase, day 1 to day 21', () => {
      expect(on('2026-01-01T09:00:00Z')).toBe(true); // day 0
      expect(on('2026-01-15T09:00:00Z')).toBe(true); // day 14
      expect(on('2026-01-21T09:00:00Z')).toBe(true); // day 20, last on day
    });

    it('suppresses the whole off-phase, day 22 to day 28', () => {
      expect(on('2026-01-22T09:00:00Z')).toBe(false); // day 21, first off day
      expect(on('2026-01-25T09:00:00Z')).toBe(false);
      expect(on('2026-01-28T09:00:00Z')).toBe(false); // day 27, last off day
    });

    it('resumes on the next cycle', () => {
      expect(on('2026-01-29T09:00:00Z')).toBe(true); // day 28 -> index 0
      expect(on('2026-02-18T09:00:00Z')).toBe(true); // day 48 -> index 20
      expect(on('2026-02-19T09:00:00Z')).toBe(false); // day 49 -> index 21
    });

    it('treats days before the anchor as outside the cycle', () => {
      expect(on('2025-12-31T09:00:00Z')).toBe(false);
    });

    it('passes everything through when no cycle is defined', () => {
      expect(isWithinCyclePhase(new Date('2026-06-01T09:00:00Z'), {})).toBe(
        true,
      );
    });

    it('does not suppress doses over a bad timezone or anchor', () => {
      const d = new Date('2026-01-25T09:00:00Z'); // would be an off day
      expect(isWithinCyclePhase(d, cycle, 'Not/AZone')).toBe(true);
      expect(
        isWithinCyclePhase(d, { ...cycle, cycleAnchorDate: 'not a date' }),
      ).toBe(true);
    });

    it('counts calendar days, so DST cannot shift the phase', () => {
      // Counting elapsed milliseconds instead would drift by an hour per
      // transition and eventually flip a boundary day. US DST began
      // 2026-03-08; day 0 is 2026-01-01 in New York.
      const tz = 'America/New_York';
      const dayIndexOf = (iso: string) => {
        // 2026-03-12 is day 70 -> 70 % 28 = 14, inside the on-phase.
        return isWithinCyclePhase(new Date(iso), cycle, tz);
      };
      expect(dayIndexOf('2026-03-12T17:00:00Z')).toBe(true); // day 70
      // 2026-03-23 is day 81 -> 81 % 28 = 25, inside the off-phase.
      expect(dayIndexOf('2026-03-23T17:00:00Z')).toBe(false);
    });
  });

  describe('generation with a cycle', () => {
    it('skips the off-week for specific_times schedules', () => {
      const times = computeDoseEventTimes(
        {
          type: 'specific_times',
          specificTimes: ['09:00'],
          ...cycle,
        },
        'UTC',
        {
          start: new Date('2026-01-01T00:00:00Z'),
          end: new Date('2026-01-28T23:59:59Z'),
        },
      );

      // 21 on days in January starting the 1st; the 22nd-28th are off.
      expect(times).toHaveLength(21);
      expect(times[0].toISOString()).toBe('2026-01-01T09:00:00.000Z');
      expect(times[20].toISOString()).toBe('2026-01-21T09:00:00.000Z');
      const days = times.map((t) => t.toISOString().slice(0, 10));
      expect(days).not.toContain('2026-01-22');
      expect(days).not.toContain('2026-01-28');
    });

    it('composes with daysOfWeek rather than overriding it', () => {
      const times = computeDoseEventTimes(
        {
          type: 'specific_times',
          specificTimes: ['09:00'],
          daysOfWeek: ['Mon'],
          ...cycle,
        },
        'UTC',
        {
          start: new Date('2026-01-01T00:00:00Z'),
          end: new Date('2026-01-31T23:59:59Z'),
        },
      );

      // Mondays in Jan 2026: 5, 12, 19, 26. The 26th falls in the off-phase.
      const days = times.map((t) => t.toISOString().slice(0, 10));
      expect(days).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
    });

    it('skips the off-phase for interval schedules too', () => {
      const times = computeDoseEventTimes(
        {
          type: 'interval',
          intervalValue: 1,
          intervalUnit: 'days',
          firstDoseAt: '2026-01-01T08:00:00Z',
          ...cycle,
        },
        'UTC',
        {
          start: new Date('2026-01-01T00:00:00Z'),
          end: new Date('2026-01-28T23:59:59Z'),
        },
      );
      expect(times).toHaveLength(21);
    });

    it('keeps the interval grid anchored across an off-phase', () => {
      // Every 2 days from Jan 1. Without filtering-in-place the grid would
      // restart after the gap and land on the wrong parity.
      const times = computeDoseEventTimes(
        {
          type: 'interval',
          intervalValue: 2,
          intervalUnit: 'days',
          firstDoseAt: '2026-01-01T08:00:00Z',
          cycleOnDays: 3,
          cycleOffDays: 3,
          cycleAnchorDate: '2026-01-01T00:00:00Z',
        },
        'UTC',
        {
          start: new Date('2026-01-01T00:00:00Z'),
          end: new Date('2026-01-13T23:59:59Z'),
        },
      );
      // Grid: 1,3,5,7,9,11,13. On-days are 1-3, 7-9, 13.
      expect(times.map((t) => t.toISOString().slice(0, 10))).toEqual([
        '2026-01-01',
        '2026-01-03',
        '2026-01-07',
        '2026-01-09',
        '2026-01-13',
      ]);
    });
  });

  describe('every-other-week intervals', () => {
    it('steps by whole weeks', () => {
      const times = computeDoseEventTimes(
        {
          type: 'interval',
          intervalValue: 2,
          intervalUnit: 'weeks',
          firstDoseAt: '2026-01-05T08:00:00Z',
        },
        'UTC',
        {
          start: new Date('2026-01-01T00:00:00Z'),
          end: new Date('2026-02-20T23:59:59Z'),
        },
      );
      expect(times.map((t) => t.toISOString().slice(0, 10))).toEqual([
        '2026-01-05',
        '2026-01-19',
        '2026-02-02',
        '2026-02-16',
      ]);
    });

    it('gets the default 90-day horizon, not the minute cap', () => {
      const now = new Date('2026-01-01T00:00:00Z');
      expect(
        horizonEndFor(
          { type: 'interval', intervalValue: 2, intervalUnit: 'weeks' },
          now,
        ).getTime(),
      ).toBe(now.getTime() + DEFAULT_HORIZON_DAYS * DAY);
    });
  });

  describe('assertValidScheduleTypeFields', () => {
    it('rejects a half-specified cycle', () => {
      expect(() =>
        assertValidScheduleTypeFields({
          type: 'specific_times',
          specificTimes: ['09:00'],
          cycleOnDays: 21,
        }),
      ).toThrow(/both cycleOnDays and cycleOffDays/);
    });

    it('rejects a zero-length phase', () => {
      expect(() =>
        assertValidScheduleTypeFields({
          type: 'specific_times',
          specificTimes: ['09:00'],
          cycleOnDays: 21,
          cycleOffDays: 0,
        }),
      ).toThrow(/must both be at least 1/);
    });

    it('rejects a cycle on a minute-grained interval', () => {
      expect(() =>
        assertValidScheduleTypeFields({
          type: 'interval',
          intervalValue: 30,
          intervalUnit: 'minutes',
          cycleOnDays: 21,
          cycleOffDays: 7,
        }),
      ).toThrow(/minute-based intervals/);
    });

    it('accepts a well-formed cycle', () => {
      expect(() =>
        assertValidScheduleTypeFields({
          type: 'specific_times',
          specificTimes: ['09:00'],
          cycleOnDays: 21,
          cycleOffDays: 7,
        }),
      ).not.toThrow();
    });
  });
});
