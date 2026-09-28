import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  unique,
  jsonb,
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
    // Local-reminder lease: the dose events this device has scheduled as
    // on-phone notifications, keyed by event id, each with the `updatedAt` it
    // had when scheduled. The reminder cron skips pushing a dose to this device
    // only while that event is still byte-for-byte the version the phone holds,
    // so an edit, snooze or new dose made anywhere else falls back to push.
    // Replaced wholesale on every sync. See NotificationsService.claimLocalReminders.
    localReminders: jsonb('local_reminders').$type<Record<string, string>>(),
    localRemindersSyncedAt: timestamp('local_reminders_synced_at'),
  },
  (table) => [unique().on(table.userId, table.deviceId)],
);
