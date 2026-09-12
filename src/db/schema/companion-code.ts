import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './user';

/**
 * One durable sharing code per user — the thing an owner reads out or texts so
 * someone can become their companion.
 *
 * Unlike the single-use invites this replaced, the code is stored in plaintext.
 * It has to be: the whole point is that the owner can come back and look it up
 * again, which a hash cannot support. That is a deliberate trade, and these are
 * the properties that keep it defensible:
 *
 *  - The code alone is not access. Redeeming it needs an authenticated ReMed
 *    account, so a leaked code still has to be carried into a signed-up user.
 *  - Redemption is rate limited (5/min) and every redemption is auditable.
 *  - The owner sees a new companion appear in their list immediately and can
 *    revoke them in one tap.
 *  - Redemption counts against the owner's companion seats, so a leaked code
 *    cannot be used to attach an unbounded number of watchers.
 *  - `rotate` issues a new code and kills the old one, which is the remedy when
 *    an owner thinks their code has spread further than they meant.
 *
 * Rows are created lazily, the first time a user opens the sharing screen —
 * most users never share, and an unused code is a liability rather than an
 * asset.
 */
export const companionCodes = pgTable(
  'companion_codes',
  {
    userId: uuid('user_id')
      .references(() => users.id)
      .primaryKey(),
    // Stored already normalized (see normalizeCompanionCode), so redemption is
    // a plain equality lookup on what the user typed, once normalized.
    code: varchar('code', { length: 16 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    // Null until the owner has rotated at least once.
    rotatedAt: timestamp('rotated_at'),
  },
  (table) => [
    // Redemption is a lookup by code, and two users must never share one.
    uniqueIndex('companion_codes_code_idx').on(table.code),
  ],
);
