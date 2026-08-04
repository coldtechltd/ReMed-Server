import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
} from 'drizzle-orm/pg-core';
import { users } from './user';

/**
 * What a user has paid for. One row per user, written only by the RevenueCat
 * webhook — never by the client, which is why every paid API path resolves
 * entitlement through this table rather than trusting anything in the request.
 *
 * `expiresAt` is what makes a missed webhook fail safe: a lapsed subscription
 * reverts to free on its own once the stored expiry passes, even if the
 * EXPIRATION event never arrived.
 */
export const entitlements = pgTable('entitlements', {
  userId: uuid('user_id')
    .references(() => users.id)
    .primaryKey(),
  tier: varchar('tier', { length: 20 }).notNull().default('free'), // 'free' | 'pro'
  source: varchar('source', { length: 20 }), // 'app_store' | 'play_store' | 'promo'
  productId: varchar('product_id', { length: 255 }),
  // Null together with isLifetime=false means "no active entitlement".
  expiresAt: timestamp('expires_at'),
  isLifetime: boolean('is_lifetime').default(false).notNull(),
  // RevenueCat's app_user_id, which we set to our own user id at login. Kept
  // for reconciling against their dashboard when a payment is disputed.
  rcAppUserId: varchar('rc_app_user_id', { length: 255 }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
