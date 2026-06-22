import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  boolean,
  integer,
} from 'drizzle-orm/pg-core';
import { schedules } from './schedule';

export const doseEvents = pgTable('dose_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  scheduleId: uuid('schedule_id')
    .references(() => schedules.id)
    .notNull(),
  scheduledFor: timestamp('scheduled_for').defaultNow().notNull(),
  takenAt: timestamp('taken_at'),
  status: varchar('status', { length: 50 }).default('pending'), // pending | taken | missed
  reminderSent: boolean('reminder_sent').default(false),
  snoozeCount: integer('snooze_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
