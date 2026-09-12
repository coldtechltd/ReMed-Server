import { BadRequestException } from '@nestjs/common';
import { CompanionService } from './companion.service';
import { normalizeCompanionCode } from './companion-code.util';

type Row = Record<string, unknown> | undefined;

/**
 * `redeemCode` runs two selects that both terminate at `.limit()` — the code
 * lookup, then the "are we already linked" check — and then an insert. The fake
 * hands back one queued row per select, so a test describes the database purely
 * as "what the two lookups find".
 */
function redeemDb(codeRow: Row, existingLink: Row, inserted: Row = { id: 'l1' }) {
  const queue: Row[] = [codeRow, existingLink];
  const captured: { values?: Record<string, unknown> } = {};

  const select: Record<string, unknown> = {
    from: () => select,
    where: () => select,
    limit: () => {
      const next = queue.shift();
      return Promise.resolve(next ? [next] : []);
    },
  };

  const insert = {
    values: (v: Record<string, unknown>) => {
      captured.values = v;
      return { returning: () => Promise.resolve([inserted]) };
    },
  };

  return {
    db: { select: () => select, insert: () => insert } as never,
    captured,
  };
}

const entitlements = (assert = jest.fn().mockResolvedValue('free')) =>
  ({ assertCompanionLimit: assert }) as never;

const config = { get: () => 'https://api.example.com' } as never;

describe('CompanionService.redeemCode', () => {
  it('creates an active link for a valid code', async () => {
    const { db, captured } = redeemDb({ ownerId: 'owner' }, undefined);
    const svc = new CompanionService(db, entitlements(), config);

    await expect(svc.redeemCode('joiner', 'ABCD2345')).resolves.toMatchObject({
      id: 'l1',
    });
    // Active from birth — there is no pending half-state under persistent codes.
    expect(captured.values).toMatchObject({
      ownerId: 'owner',
      companionId: 'joiner',
      status: 'active',
    });
  });

  // The failure message must not distinguish "never existed" from "rotated
  // away", or the route becomes an oracle for which codes are live.
  it('rejects an unknown code without saying why', async () => {
    const { db } = redeemDb(undefined, undefined);
    const svc = new CompanionService(db, entitlements(), config);

    await expect(svc.redeemCode('joiner', 'ZZZZ9999')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses to let someone redeem their own code', async () => {
    const { db } = redeemDb({ ownerId: 'me' }, undefined);
    const svc = new CompanionService(db, entitlements(), config);

    await expect(svc.redeemCode('me', 'ABCD2345')).rejects.toThrow(
      /your own code/i,
    );
  });

  // Re-entering a code from a second device must not create a duplicate row —
  // the partial unique index would reject it, surfacing as a 500.
  it('is idempotent when the link already exists', async () => {
    const existing = { id: 'already', status: 'active' };
    const { db, captured } = redeemDb({ ownerId: 'owner' }, existing);
    const assert = jest.fn();
    const svc = new CompanionService(db, entitlements(assert), config);

    await expect(svc.redeemCode('joiner', 'ABCD2345')).resolves.toBe(existing);
    expect(captured.values).toBeUndefined();
    // And it must not spend one of the owner's seats a second time.
    expect(assert).not.toHaveBeenCalled();
  });

  // Seats belong to the owner even though the joiner is the caller, so the
  // check has to name the owner — charging the joiner's plan would let anyone
  // with a pro account bypass a free owner's single-seat limit.
  it('checks the seat limit against the owner, addressed to the joiner', async () => {
    const assert = jest.fn().mockResolvedValue('free');
    const { db } = redeemDb({ ownerId: 'owner' }, undefined);
    const svc = new CompanionService(db, entitlements(assert), config);

    await svc.redeemCode('joiner', 'ABCD2345');
    expect(assert).toHaveBeenCalledWith('owner', 'joiner');
  });

  it('accepts a code the user typed with separators and misread glyphs', async () => {
    const { db } = redeemDb({ ownerId: 'owner' }, undefined);
    const svc = new CompanionService(db, entitlements(), config);

    // 'O' for 0 and a hyphen: normalization happens before the lookup, so this
    // reaches the database as the stored form.
    await expect(svc.redeemCode('joiner', 'abcd-2o45')).resolves.toBeDefined();
    expect(normalizeCompanionCode('abcd-2o45')).toBe('ABCD2045');
  });
});
