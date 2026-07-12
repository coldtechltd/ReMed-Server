import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { users } from './user';

// One row per (user, installed app) pair, so push notifications and logout
// are scoped to a single device instead of the whole account.
export const deviceSessions = pgTable(
  'device_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    deviceId: varchar('device_id', { length: 255 }).notNull(),
    expoPushToken: varchar('expo_push_token', { length: 255 }),
    tokenVersion: integer('token_version').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    lastSeenAt: timestamp('last_seen_at').defaultNow(),
  },
  (table) => [unique().on(table.userId, table.deviceId)],
);
