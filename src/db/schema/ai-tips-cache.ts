import { pgTable, uuid, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { users } from './user';

// Wellness tips are regenerated at most once a day per user. Without this the
// AI tab refetched on every mount, firing a fresh 70B completion each time the
// user tabbed away and back — by far the largest avoidable model spend.
export const aiTipsCache = pgTable('ai_tips_cache', {
  userId: uuid('user_id')
    .references(() => users.id)
    .primaryKey(),
  tips: jsonb('tips').$type<string[]>().notNull(),
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
});
