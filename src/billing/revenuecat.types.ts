/**
 * The subset of RevenueCat's webhook payload we act on.
 *
 * Deliberately parsed by hand rather than through a class-validator DTO: the
 * app's global ValidationPipe runs with `forbidNonWhitelisted: true`, which
 * would 400 every webhook the moment RevenueCat adds a field we haven't
 * declared. A third-party payload we don't control is exactly the wrong place
 * for strict whitelisting.
 */
export interface RevenueCatEvent {
  type: string;
  app_user_id?: string;
  original_app_user_id?: string;
  product_id?: string;
  store?: string;
  period_type?: string;
  environment?: string;
  expiration_at_ms?: number | null;
  purchased_at_ms?: number | null;
}

/** Access ends immediately. */
const REVOKING_EVENTS = new Set(['EXPIRATION', 'SUBSCRIPTION_PAUSED']);

/**
 * Access continues to the already-known expiry. CANCELLATION only means
 * auto-renew was switched off — the user keeps what they paid for until the
 * period ends, and treating it as a revocation is the classic way to
 * accidentally cut off a paying customer. BILLING_ISSUE is likewise a grace
 * period, not a termination.
 */
const GRANTING_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'CANCELLATION',
  'BILLING_ISSUE',
  'SUBSCRIPTION_EXTENDED',
  'TRANSFER',
]);

export type ParsedEntitlement =
  | { action: 'grant'; expiresAt: Date | null; isLifetime: boolean }
  | { action: 'revoke' }
  | { action: 'ignore' };

export function parseEvent(event: RevenueCatEvent): ParsedEntitlement {
  if (REVOKING_EVENTS.has(event.type)) return { action: 'revoke' };
  if (!GRANTING_EVENTS.has(event.type)) return { action: 'ignore' };

  const expiresAt =
    typeof event.expiration_at_ms === 'number' && event.expiration_at_ms > 0
      ? new Date(event.expiration_at_ms)
      : null;

  // A one-off purchase with no expiry is the lifetime unlock.
  const isLifetime =
    event.type === 'NON_RENEWING_PURCHASE' && expiresAt === null;

  // A renewing subscription with no expiry is a malformed event — refuse to
  // grant open-ended access off it rather than guessing.
  if (!isLifetime && expiresAt === null) return { action: 'ignore' };

  return { action: 'grant', expiresAt, isLifetime };
}

export function storeToSource(store?: string): string | null {
  switch (store) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'app_store';
    case 'PLAY_STORE':
      return 'play_store';
    case 'PROMOTIONAL':
      return 'promo';
    default:
      return null;
  }
}
