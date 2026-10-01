import {
  AdherenceRow,
  classifyDay,
  doseCredit,
  previousDayKey,
  summarizeAdherence,
} from './adherence.util';

const row = (
  dayKey: string,
  status: string,
  extra: Partial<AdherenceRow> = {},
): AdherenceRow => ({
  status,
  dayKey,
  medicationName: 'Metformin',
  takenAmount: null,
  dosageAmount: 2,
  ...extra,
});

const TODAY = '2026-03-10';

describe('adherence rate', () => {
  it('scores missed doses against the rate', () => {
    const s = summarizeAdherence(
      [
        row(TODAY, 'taken'),
        row(TODAY, 'taken'),
        row(TODAY, 'taken'),
        row(TODAY, 'missed'),
      ],
      TODAY,
    );
    expect(s.adherenceRate).toBe(0.75);
  });

  // The point of the status: a doctor-advised pause is not forgetfulness.
  it('leaves skipped doses out of the rate but still counts them', () => {
    const s = summarizeAdherence(
      [row(TODAY, 'taken'), row(TODAY, 'taken'), row(TODAY, 'skipped')],
      TODAY,
    );
    expect(s.adherenceRate).toBe(1);
    expect(s.totals.skipped).toBe(1);
  });

  it('credits a partial dose by the fraction taken', () => {
    const s = summarizeAdherence(
      [row(TODAY, 'taken'), row(TODAY, 'partial', { takenAmount: 1 })],
      TODAY,
    );
    // (1 + 1/2) / 2
    expect(s.adherenceRate).toBe(0.75);
    expect(s.totals.partial).toBe(1);
  });

  it('has no rate when nothing scorable happened', () => {
    const s = summarizeAdherence(
      [row(TODAY, 'skipped'), row(TODAY, 'pending')],
      TODAY,
    );
    expect(s.adherenceRate).toBeNull();
  });

  it('files unknown statuses under pending, as before', () => {
    const s = summarizeAdherence([row(TODAY, 'mystery')], TODAY);
    expect(s.totals.pending).toBe(1);
  });
});

describe('doseCredit', () => {
  it('clamps a partial amount to one full dose', () => {
    expect(
      doseCredit({ status: 'partial', takenAmount: 5, dosageAmount: 2 }),
    ).toBe(1);
  });

  it('gives nothing for a partial row without an amount', () => {
    expect(
      doseCredit({ status: 'partial', takenAmount: null, dosageAmount: 2 }),
    ).toBe(0);
  });
});

describe('classifyDay', () => {
  const counts = (c: Partial<Record<string, number>>) => ({
    taken: 0,
    partial: 0,
    skipped: 0,
    missed: 0,
    pending: 0,
    ...c,
  });

  it('breaks on any missed dose, even alongside taken ones', () => {
    expect(classifyDay(counts({ taken: 2, missed: 1 }))).toBe('broken');
  });

  it('treats a partial dose as showing up', () => {
    expect(classifyDay(counts({ partial: 1 }))).toBe('adherent');
  });

  it('is neutral only once every dose was skipped', () => {
    expect(classifyDay(counts({ skipped: 2 }))).toBe('neutral');
    expect(classifyDay(counts({ skipped: 1, pending: 1 }))).toBe('open');
  });
});

describe('streaks', () => {
  it('carries a streak through a day where everything was skipped', () => {
    const s = summarizeAdherence(
      [
        row('2026-03-07', 'taken'),
        row('2026-03-08', 'skipped'),
        row('2026-03-09', 'taken'),
        row(TODAY, 'taken'),
      ],
      TODAY,
    );
    // The skipped day neither grows nor ends it.
    expect(s.currentStreak).toBe(3);
    expect(s.longestStreak).toBe(3);
  });

  it('ends a streak on a missed dose', () => {
    const s = summarizeAdherence(
      [
        row('2026-03-07', 'taken'),
        row('2026-03-08', 'missed'),
        row('2026-03-09', 'taken'),
        row(TODAY, 'taken'),
      ],
      TODAY,
    );
    expect(s.currentStreak).toBe(2);
    expect(s.longestStreak).toBe(2);
  });

  it('is zero when today already has a missed dose', () => {
    const s = summarizeAdherence(
      [row('2026-03-09', 'taken'), row(TODAY, 'missed')],
      TODAY,
    );
    expect(s.currentStreak).toBe(0);
  });

  // A day in progress mustn't reset the streak before its doses are due.
  it('does not punish today for doses not yet due', () => {
    const s = summarizeAdherence(
      [row('2026-03-09', 'taken'), row(TODAY, 'pending')],
      TODAY,
    );
    expect(s.currentStreak).toBe(1);
  });

  it('still counts back from yesterday when today has no doses at all', () => {
    const s = summarizeAdherence(
      [row('2026-03-08', 'taken'), row('2026-03-09', 'taken')],
      TODAY,
    );
    expect(s.currentStreak).toBe(2);
  });

  it('ends the longest run at a calendar gap', () => {
    const s = summarizeAdherence(
      [
        row('2026-03-01', 'taken'),
        row('2026-03-02', 'taken'),
        row('2026-03-04', 'taken'),
      ],
      TODAY,
    );
    expect(s.longestStreak).toBe(2);
  });
});

describe('breakdowns', () => {
  it('reports every status per day and per medication', () => {
    const s = summarizeAdherence(
      [
        row(TODAY, 'taken'),
        row(TODAY, 'partial', { takenAmount: 1 }),
        row(TODAY, 'skipped'),
        row(TODAY, 'missed', { medicationName: 'Lisinopril' }),
      ],
      TODAY,
    );

    expect(s.byDay).toEqual([
      { date: TODAY, taken: 1, partial: 1, skipped: 1, missed: 1, pending: 0 },
    ]);
    expect(s.perMedication).toEqual([
      {
        name: 'Metformin',
        taken: 1,
        partial: 1,
        skipped: 1,
        missed: 0,
        adherenceRate: 0.75,
      },
      {
        name: 'Lisinopril',
        taken: 0,
        partial: 0,
        skipped: 0,
        missed: 1,
        adherenceRate: 0,
      },
    ]);
  });
});

describe('previousDayKey', () => {
  it('crosses month and leap-year boundaries', () => {
    expect(previousDayKey('2026-03-01')).toBe('2026-02-28');
    expect(previousDayKey('2028-03-01')).toBe('2028-02-29');
    expect(previousDayKey('2026-01-01')).toBe('2025-12-31');
  });
});
