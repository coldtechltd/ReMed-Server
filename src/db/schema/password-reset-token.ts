import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './user';

/**
 * One-time 6-digit reset codes for the forgot-password flow. Only a bcrypt
 * hash of the code is stored — a leaked table must not be enough to take over
 * accounts. Requesting a new code invalidates the previous ones (usedAt is
 * stamped), and codes expire after 15 minutes regardless.
 */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    codeHash: varchar('code_hash', { length: 255 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('password_reset_tokens_user_idx').on(table.userId)],
);
