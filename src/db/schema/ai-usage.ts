import { pgTable, uuid, integer, date, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './user';

/**
 * Daily per-user rollup of AI calls and the tokens they consumed.
 *
 * Serves two purposes at once, which is why it's a single cheap table: it
 * enforces the free tier's daily allowance, and it's the only place actual
 * model spend is attributable to a user. The controller's `@Throttle` is
 * per-IP and in-memory — it stops a burst but never steady spend, and it
 * resets on every deploy.
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    // UTC calendar day. Kept as a string ('YYYY-MM-DD') so the quota window is
    // a plain equality check with no timezone arithmetic at read time.
    day: date('day', { mode: 'string' }).notNull(),
    tipsCalls: integer('tips_calls').default(0).notNull(),
    chatCalls: integer('chat_calls').default(0).notNull(),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);
