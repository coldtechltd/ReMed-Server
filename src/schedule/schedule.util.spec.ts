import {
  computeDoseEventTimes,
  endOfDayInTz,
  startOfDayInTz,
  horizonEndFor,
  MAX_EVENTS_PER_GENERATION,
  DEFAULT_HORIZON_DAYS,
} from './schedule.util';
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
