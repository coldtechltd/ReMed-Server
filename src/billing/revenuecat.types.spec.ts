import { parseEvent, storeToSource } from './revenuecat.types';

const HOUR = 60 * 60 * 1000;

describe('parseEvent', () => {
  const future = Date.now() + 24 * HOUR;

  it('grants Pro on an initial purchase, carrying the expiry through', () => {
    const result = parseEvent({
      type: 'INITIAL_PURCHASE',
      expiration_at_ms: future,
    });
    expect(result).toEqual({
      action: 'grant',
      expiresAt: new Date(future),
      isLifetime: false,
    });
  });

  it('grants on renewal', () => {
    expect(
      parseEvent({ type: 'RENEWAL', expiration_at_ms: future }).action,
    ).toBe('grant');
  });

  // The expensive mistake: CANCELLATION means auto-renew was switched off, not
  // that access ended. Treating it as a revocation cuts off a user who has
  // already paid through the end of the period.
  it('keeps access on CANCELLATION until the paid period actually ends', () => {
    const result = parseEvent({
      type: 'CANCELLATION',
      expiration_at_ms: future,
    });
    expect(result).toEqual({
      action: 'grant',
      expiresAt: new Date(future),
      isLifetime: false,
    });
  });

  it('keeps access during a BILLING_ISSUE grace period', () => {
    expect(
      parseEvent({ type: 'BILLING_ISSUE', expiration_at_ms: future }).action,
    ).toBe('grant');
  });

  it('revokes on EXPIRATION', () => {
    expect(parseEvent({ type: 'EXPIRATION' })).toEqual({ action: 'revoke' });
  });

  it('revokes on SUBSCRIPTION_PAUSED', () => {
    expect(parseEvent({ type: 'SUBSCRIPTION_PAUSED' })).toEqual({
      action: 'revoke',
    });
  });

  it('treats a non-renewing purchase with no expiry as the lifetime unlock', () => {
    expect(
      parseEvent({
        type: 'NON_RENEWING_PURCHASE',
        product_id: 'remed_lifetime',
      }),
    ).toEqual({ action: 'grant', expiresAt: null, isLifetime: true });
  });

  it('refuses to grant open-ended access from a renewal missing its expiry', () => {
    expect(parseEvent({ type: 'RENEWAL' })).toEqual({ action: 'ignore' });
    expect(parseEvent({ type: 'RENEWAL', expiration_at_ms: null })).toEqual({
      action: 'ignore',
    });
  });

  it('ignores event types it does not model rather than guessing', () => {
    expect(parseEvent({ type: 'TEST' }).action).toBe('ignore');
    expect(parseEvent({ type: 'SOMETHING_NEW_IN_2027' }).action).toBe('ignore');
  });
});

describe('storeToSource', () => {
  it('maps the stores we sell through', () => {
    expect(storeToSource('APP_STORE')).toBe('app_store');
    expect(storeToSource('PLAY_STORE')).toBe('play_store');
    expect(storeToSource('PROMOTIONAL')).toBe('promo');
  });

  it('returns null for anything unrecognised', () => {
    expect(storeToSource('STRIPE')).toBeNull();
    expect(storeToSource(undefined)).toBeNull();
  });
});
