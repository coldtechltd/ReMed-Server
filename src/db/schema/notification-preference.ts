import {
  boolean,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './user';

/**
 * Per-user notification settings.
 *
 * One row per user, created lazily on first write — absent means "defaults",
 * so no backfill is needed and a user who never opens the settings screen
 * costs nothing.
 *
 * `doseRemindersEnabled` is the server-side half of the app's master Reminders
 * switch. The client toggle previously only stopped the device registering a
 * push token, which the server never learned about — so turning reminders off
 * left the server happily pushing to a token the app had stopped acknowledging.
 *
 * Quiet hours intentionally do NOT gate dose reminders; see quiet-hours.util.
 */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .references(() => users.id)
    .primaryKey(),
  doseRemindersEnabled: boolean('dose_reminders_enabled')
    .default(true)
    .notNull(),
  refillRemindersEnabled: boolean('refill_reminders_enabled')
    .default(true)
    .notNull(),
  companionAlertsEnabled: boolean('companion_alerts_enabled')
    .default(true)
    .notNull(),
  quietHoursEnabled: boolean('quiet_hours_enabled').default(false).notNull(),
  /** "HH:MM" wall-clock in `timezone`. */
  quietHoursStart: varchar('quiet_hours_start', { length: 5 }).default('22:00'),
  quietHoursEnd: varchar('quiet_hours_end', { length: 5 }).default('07:00'),
  /** Default snooze offered in-app and on the notification action. */
  defaultSnoozeMinutes: integer('default_snooze_minutes').default(15).notNull(),
  /**
   * The user's home IANA zone, sent by the client when they save. Quiet hours
   * are a single user-level wall-clock window, so they can't be evaluated
   * against a per-schedule timezone the way dose generation is.
   */
  timezone: varchar('timezone', { length: 64 }),
  updatedAt: timestamp('updated_at').defaultNow(),
});
