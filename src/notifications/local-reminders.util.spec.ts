import {
  MAX_LOCAL_REMINDERS,
  doseReminderCopy,
  isCoveredLocally,
  sanitizeClaim,
} from './local-reminders.util';

describe('isCoveredLocally', () => {
  const updatedAt = new Date('2026-09-28T08:00:00.123Z');
  const event = { id: 'e1', updatedAt };

  it('covers an event the device scheduled at this exact version', () => {
    expect(isCoveredLocally({ e1: updatedAt.toISOString() }, event)).toBe(true);
  });

  it('does not cover an event changed after the device scheduled it', () => {
    // A snooze or edit elsewhere bumps updatedAt; the phone's copy is stale,
    // so the dose must fall back to push rather than go unreminded.
    const later = { id: 'e1', updatedAt: new Date(updatedAt.getTime() + 1) };
    expect(isCoveredLocally({ e1: updatedAt.toISOString() }, later)).toBe(
      false,
    );
  });

  it('does not cover an event the device never scheduled', () => {
    expect(isCoveredLocally({ other: updatedAt.toISOString() }, event)).toBe(
      false,
    );
  });

  it('does not cover anything without a claim', () => {
    expect(isCoveredLocally(null, event)).toBe(false);
    expect(isCoveredLocally(undefined, event)).toBe(false);
  });

  it('ignores a malformed claimed timestamp', () => {
    expect(isCoveredLocally({ e1: 'not a date' }, event)).toBe(false);
  });
});

describe('sanitizeClaim', () => {
  const at = '2026-09-28T08:00:00.000Z';

  it('keeps only events the user owns', () => {
    const claim = sanitizeClaim(
      [
        { eventId: 'mine', updatedAt: at },
        { eventId: 'theirs', updatedAt: at },
      ],
      new Set(['mine']),
    );
    expect(claim).toEqual({ mine: at });
  });

  it('drops malformed timestamps', () => {
    expect(
      sanitizeClaim([{ eventId: 'a', updatedAt: 'nope' }], new Set(['a'])),
    ).toEqual({});
  });

  it('caps the claim size', () => {
    const entries = Array.from({ length: MAX_LOCAL_REMINDERS + 5 }, (_, i) => ({
      eventId: `e${i}`,
      updatedAt: at,
    }));
    const claim = sanitizeClaim(
      entries,
      new Set(entries.map((e) => e.eventId)),
    );
    expect(Object.keys(claim)).toHaveLength(MAX_LOCAL_REMINDERS);
  });
});

describe('doseReminderCopy', () => {
  it('matches the push wording', () => {
    expect(
      doseReminderCopy(
        { name: 'Amoxicillin' },
        { name: 'Capsule', dosageAmount: 500, dosageUnit: 'mg' },
      ),
    ).toEqual({
      title: 'Time to take Amoxicillin',
      body: '500 mg of Capsule',
    });
  });
});
