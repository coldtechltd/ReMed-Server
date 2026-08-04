import { HttpException } from '@nestjs/common';
import { EntitlementService, QUOTAS } from './entitlement.service';

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
