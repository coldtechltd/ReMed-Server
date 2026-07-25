import { projectStock, daysUntil } from './stock.util';

const DAY = 24 * 60 * 60 * 1000;
const BASE = new Date('2026-07-25T08:00:00Z');

/** n doses, one per day starting at BASE. */
const dailyDoses = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    scheduledFor: new Date(BASE.getTime() + i * DAY),
  }));

describe('projectStock', () => {
  it('reports the first dose that stock cannot cover', () => {
    const events = dailyDoses(10);
    const result = projectStock(3, 1, events);

    // 3 pills, 1 per dose: doses 1-3 covered, the 4th runs out.
    expect(result.dosesCovered).toBe(3);
    expect(result.runsOutAt).toEqual(events[3].scheduledFor);
    expect(result.coveredThrough).toEqual(events[2].scheduledFor);
  });

  it('treats stock landing on exactly zero as covered', () => {
    const events = dailyDoses(3);
    const result = projectStock(3, 1, events);

    // Balance hits exactly 0 on the last dose — still covered, nothing runs out.
    expect(result.runsOutAt).toBeNull();
    expect(result.dosesCovered).toBe(3);
    expect(result.coveredThrough).toEqual(events[2].scheduledFor);
  });

  it('accounts for multi-unit doses', () => {
    const events = dailyDoses(10);
    const result = projectStock(5, 2, events);

    // 5 units at 2 per dose: 2 doses covered (1 left), the 3rd goes negative.
    expect(result.dosesCovered).toBe(2);
    expect(result.runsOutAt).toEqual(events[2].scheduledFor);
  });

  it('runs out on the very first dose when a single dose exceeds stock', () => {
    const events = dailyDoses(4);
    const result = projectStock(1, 5, events);

    expect(result.dosesCovered).toBe(0);
    expect(result.runsOutAt).toEqual(events[0].scheduledFor);
    expect(result.coveredThrough).toBeNull();
  });

  it('reports no run-out when stock outlasts every known dose', () => {
    const events = dailyDoses(4);
    const result = projectStock(100, 1, events);

    expect(result.runsOutAt).toBeNull();
    expect(result.dosesCovered).toBe(4);
    expect(result.coveredThrough).toEqual(events[3].scheduledFor);
  });

  it('handles having no upcoming doses at all (e.g. as-needed schedules)', () => {
    const result = projectStock(10, 1, []);

    expect(result.runsOutAt).toBeNull();
    expect(result.coveredThrough).toBeNull();
    expect(result.dosesCovered).toBe(0);
  });

  it('runs out immediately when stock is already zero', () => {
    const events = dailyDoses(2);
    const result = projectStock(0, 1, events);

    expect(result.dosesCovered).toBe(0);
    expect(result.runsOutAt).toEqual(events[0].scheduledFor);
  });
});

describe('daysUntil', () => {
  it('floors partial days', () => {
    const runsOut = new Date(BASE.getTime() + 2 * DAY + 13 * 60 * 60 * 1000);
    expect(daysUntil(runsOut, BASE)).toBe(2);
  });

  it('clamps a past date to zero rather than going negative', () => {
    expect(daysUntil(new Date(BASE.getTime() - 5 * DAY), BASE)).toBe(0);
  });
});
