import {
  companionMissedDoseCopy,
  companionRefillCopy,
  displayFirstName,
  formatDoseTime,
} from './companion-notification.util';

describe('displayFirstName', () => {
  it('takes the given name only', () => {
    expect(displayFirstName('Ada Nwosu')).toBe('Ada');
  });

  // Companions routinely have no profile — they skip profile creation
  // entirely — so every caller can hand this a null.
  it('falls back rather than rendering "undefined missed a dose"', () => {
    expect(displayFirstName(null)).toBe('Someone');
    expect(displayFirstName(undefined)).toBe('Someone');
    expect(displayFirstName('   ')).toBe('Someone');
  });
});

describe('formatDoseTime', () => {
  const at = new Date('2026-03-01T20:00:00.000Z');

  it('renders in the schedule timezone, not the server one', () => {
    expect(formatDoseTime(at, 'UTC')).toBe('8:00 PM');
    expect(formatDoseTime(at, 'Africa/Lagos')).toBe('9:00 PM');
  });

  // A cron must not throw on one bad row and lose the whole batch.
  it('falls back to UTC on an unknown timezone', () => {
    expect(formatDoseTime(at, 'Not/AZone')).toBe('8:00 PM');
    expect(formatDoseTime(at, null)).toBe('8:00 PM');
  });
});

describe('companionMissedDoseCopy', () => {
  const at = new Date('2026-03-01T20:00:00.000Z');

  it('names the medication and time for a single miss', () => {
    const copy = companionMissedDoseCopy(
      'Ada Nwosu',
      [{ medicationName: 'Metformin', scheduledFor: at }],
      'UTC',
    );
    expect(copy.title).toBe('Ada missed a dose');
    expect(copy.body).toBe('Metformin at 8:00 PM');
  });

  // The anti-nag rule: one push per companion per run, however many doses.
  it('summarizes several misses into one message', () => {
    const copy = companionMissedDoseCopy(
      'Ada',
      [
        { medicationName: 'Metformin', scheduledFor: at },
        { medicationName: 'Lisinopril', scheduledFor: at },
      ],
      'UTC',
    );
    expect(copy.title).toBe('Ada missed 2 doses');
    expect(copy.body).toBe('Metformin and Lisinopril');
  });

  it('does not repeat one medication missed several times', () => {
    const copy = companionMissedDoseCopy(
      'Ada',
      [
        { medicationName: 'Metformin', scheduledFor: at },
        { medicationName: 'Metformin', scheduledFor: at },
      ],
      'UTC',
    );
    expect(copy.title).toBe('Ada missed 2 doses');
    expect(copy.body).toBe('Metformin');
  });

  it('truncates a long list instead of overflowing the notification', () => {
    const copy = companionMissedDoseCopy(
      'Ada',
      ['A', 'B', 'C', 'D'].map((medicationName) => ({
        medicationName,
        scheduledFor: at,
      })),
      'UTC',
    );
    expect(copy.title).toBe('Ada missed 4 doses');
    expect(copy.body).toBe('A, B and 2 more');
  });
});

describe('companionRefillCopy', () => {
  it('phrases the run-out about the owner, not to them', () => {
    expect(companionRefillCopy('Ada Nwosu', 'Metformin', 3)).toEqual({
      title: 'Ada needs a refill',
      body: 'Ada runs out of Metformin in 3 days.',
    });
  });

  it('reads naturally at the day boundaries', () => {
    expect(companionRefillCopy('Ada', 'Metformin', 0).body).toBe(
      'Ada runs out of Metformin today.',
    );
    expect(companionRefillCopy('Ada', 'Metformin', 1).body).toBe(
      'Ada runs out of Metformin tomorrow.',
    );
  });

  // As-needed medications have no projectable run-out date.
  it('handles an unprojectable run-out', () => {
    expect(companionRefillCopy('Ada', 'Metformin', null).body).toBe(
      'Ada is running low on Metformin.',
    );
  });
});
