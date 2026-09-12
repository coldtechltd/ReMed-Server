import { HttpException } from '@nestjs/common';
import {
  COMPANION_LIMITS,
  COMPANION_LIMIT_REACHED,
  EntitlementService,
  QUOTAS,
} from './entitlement.service';

const DAY = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown> | undefined;

/**
 * Minimal stand-in for the drizzle fluent chain. `getStatus` reads
 * `entitlements` and `getUsageToday` reads `ai_usage`, so the queue returns one
 * result per `select()` in call order.
 */
function mockDb(results: Row[]) {
  const queue = [...results];
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(queue.length ? [queue.shift()] : []),
  };
  return { select: () => chain } as never;
}

function service(results: Row[]) {
  return new EntitlementService(mockDb(results));
}

describe('EntitlementService.getStatus', () => {
  it('is free when no entitlement row exists', async () => {
    const status = await service([undefined]).getStatus('u1');
    expect(status.tier).toBe('free');
    expect(status.isLifetime).toBe(false);
  });

  it('is pro while the stored expiry is in the future', async () => {
    const expiresAt = new Date(Date.now() + DAY);
    const status = await service([
      { tier: 'pro', isLifetime: false, expiresAt, productId: 'remed_monthly' },
    ]).getStatus('u1');

    expect(status.tier).toBe('pro');
    expect(status.expiresAt).toEqual(expiresAt);
  });

  // The fail-safe: if the EXPIRATION webhook never arrives, the stored expiry
  // still lapses the account on its own. Missing a webhook can cost us
  // revenue, never free access.
  it('falls back to free once the stored expiry has passed', async () => {
    const status = await service([
      {
        tier: 'pro',
        isLifetime: false,
        expiresAt: new Date(Date.now() - DAY),
        productId: 'remed_monthly',
      },
    ]).getStatus('u1');

    expect(status.tier).toBe('free');
  });

  it('keeps a lifetime purchase active with no expiry at all', async () => {
    const status = await service([
      {
        tier: 'pro',
        isLifetime: true,
        expiresAt: null,
        productId: 'remed_lifetime',
      },
    ]).getStatus('u1');

    expect(status.tier).toBe('pro');
    expect(status.isLifetime).toBe(true);
  });
});

describe('EntitlementService.assertQuota', () => {
  it('allows a free user below the daily chat allowance', async () => {
    const svc = service([undefined, { tipsCalls: 0, chatCalls: 4 }]);
    await expect(svc.assertQuota('u1', 'chat')).resolves.toBe('free');
  });

  it('throws 402 once a free user reaches the chat allowance', async () => {
    const svc = service([
      undefined,
      { tipsCalls: 0, chatCalls: QUOTAS.free.chat },
    ]);

    await expect(svc.assertQuota('u1', 'chat')).rejects.toBeInstanceOf(
      HttpException,
    );

    try {
      await service([
        undefined,
        { tipsCalls: 0, chatCalls: QUOTAS.free.chat },
      ]).assertQuota('u1', 'chat');
      fail('expected assertQuota to throw');
    } catch (err) {
      const e = err as HttpException;
      expect(e.getStatus()).toBe(402);
      expect(e.getResponse()).toMatchObject({
        code: 'AI_QUOTA_EXCEEDED',
        kind: 'chat',
        tier: 'free',
        limit: QUOTAS.free.chat,
      });
    }
  });

  it('lets a pro user past the free ceiling', async () => {
    const svc = service([
      { tier: 'pro', isLifetime: true, expiresAt: null, productId: 'p' },
      { tipsCalls: 0, chatCalls: QUOTAS.free.chat + 10 },
    ]);
    await expect(svc.assertQuota('u1', 'chat')).resolves.toBe('pro');
  });

  it('still caps a pro user at the abuse ceiling', async () => {
    const svc = service([
      { tier: 'pro', isLifetime: true, expiresAt: null, productId: 'p' },
      { tipsCalls: 0, chatCalls: QUOTAS.pro.chat },
    ]);
    await expect(svc.assertQuota('u1', 'chat')).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('meters tips separately from chat', async () => {
    const svc = service([
      undefined,
      { tipsCalls: QUOTAS.free.tips, chatCalls: 0 },
    ]);
    await expect(svc.assertQuota('u1', 'tips')).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});

/**
 * `assertCompanionLimit` reads entitlements (via getStatus, which ends in
 * `.limit()`) and then counts companion_links (which awaits `.where()`
 * directly). The chain therefore has to terminate at either point — but
 * consume exactly one queued result per query, so `where()` resolves lazily
 * rather than eagerly shifting.
 */
function companionDb(entitlementRow: Row, used: number) {
  const queue: Row[] = [entitlementRow, { used }];
  const take = () => (queue.length ? [queue.shift()] : []);

  const chain: Record<string, unknown> = {
    from: () => chain,
    limit: () => Promise.resolve(take()),
    where: () => whereResult,
  };
  // Chainable for getStatus's trailing `.limit()`, awaitable for the count
  // query that ends at `where`.
  const whereResult = {
    ...chain,
    then: (res: (v: Row[]) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(take()).then(res, rej),
  };

  return { select: () => chain } as never;
}

describe('EntitlementService.assertCompanionLimit', () => {
  const free = undefined;
  const pro = {
    tier: 'pro',
    isLifetime: true,
    expiresAt: null,
    productId: 'p',
  };

  it('lets a free user create their first companion link', async () => {
    const svc = new EntitlementService(companionDb(free, 0));
    await expect(svc.assertCompanionLimit('u1')).resolves.toBe('free');
  });

  it('throws 402 once a free user has used their single seat', async () => {
    const svc = new EntitlementService(
      companionDb(free, COMPANION_LIMITS.free),
    );
    await expect(svc.assertCompanionLimit('u1')).rejects.toMatchObject({
      response: { code: COMPANION_LIMIT_REACHED, tier: 'free', limit: 1 },
    });
  });

  // The joiner cannot fix the owner's plan, so they must never be told to buy
  // anything — but the machine-readable code stays the same so the app can
  // still branch on it.
  it('addresses the joiner without an upsell when they are the caller', async () => {
    const svc = new EntitlementService(companionDb(free, COMPANION_LIMITS.free));
    await expect(
      svc.assertCompanionLimit('owner', 'joiner'),
    ).rejects.toMatchObject({
      response: { code: COMPANION_LIMIT_REACHED, audience: 'joiner' },
    });
    await expect(
      new EntitlementService(
        companionDb(free, COMPANION_LIMITS.free),
      ).assertCompanionLimit('owner', 'joiner'),
    ).rejects.toMatchObject({
      response: { message: expect.not.stringContaining('Upgrade') },
    });
  });

  // The upgrade path: the same count that blocks a free user is fine on pro.
  it('lets a pro user past the free ceiling', async () => {
    const svc = new EntitlementService(companionDb(pro, COMPANION_LIMITS.free));
    await expect(svc.assertCompanionLimit('u1')).resolves.toBe('pro');
  });

  it('still caps a pro user at their own limit', async () => {
    const svc = new EntitlementService(companionDb(pro, COMPANION_LIMITS.pro));
    await expect(svc.assertCompanionLimit('u1')).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  // Distinct from AI_QUOTA_EXCEEDED so the app does not show AI-usage copy on
  // the paywall it opens.
  it('does not reuse the AI quota error code', async () => {
    const svc = new EntitlementService(companionDb(free, 5));
    await expect(svc.assertCompanionLimit('u1')).rejects.toMatchObject({
      response: { code: 'COMPANION_LIMIT_REACHED' },
    });
  });
});
