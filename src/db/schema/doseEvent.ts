import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  boolean,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { schedules } from './schedule';

// Highest-volume table by far: every active schedule materializes up to a
// 90-day horizon of rows. The two indexes below cover the only two shapes
// anything queries it by — see the comments on each.
export const doseEvents = pgTable(
  'dose_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scheduleId: uuid('schedule_id')
      .references(() => schedules.id)
      .notNull(),
    scheduledFor: timestamp('scheduled_for').defaultNow().notNull(),
    takenAt: timestamp('taken_at'),
    status: varchar('status', { length: 50 }).default('pending'), // pending | taken | missed
    reminderSent: boolean('reminder_sent').default(false),
    // Latch for the companion missed-dose alert. Deliberately NOT reminderSent:
    // that one is the owner's due-reminder flag and is already true by the time
    // a dose is marked missed, so reusing it would suppress every alert.
    companionAlertSentAt: timestamp('companion_alert_sent_at'),
    snoozeCount: integer('snooze_count').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    // Per-schedule lookups: generator idempotency checks, by-date screens,
    // stats, and the AI stock projection's "next N pending doses" scan.
    index('dose_events_schedule_status_due_idx').on(
      table.scheduleId,
      table.status,
      table.scheduledFor,
    ),
    // The cross-user scans: the every-minute reminder sweep and the hourly
    // missed-marking cron both filter on status + a scheduledFor window.
    index('dose_events_status_due_idx').on(table.status, table.scheduledFor),
  ],
);
