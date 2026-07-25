import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './user';

export const medications = pgTable('medications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(), // e.g. "Malaria Treatment"
  notes: text('notes'),
  // 'continuous' = taken indefinitely (no endDate, gets refill reminders);
  // 'course' = a bounded treatment that finishes (endDate required).
  type: varchar('type', { length: 20 }).notNull().default('continuous'),
  // Lifecycle, distinct from schedules.isActive (which is the user's per-schedule
  // reminder toggle). Both must be true for doses/reminders to fire.
  status: varchar('status', { length: 20 }).notNull().default('active'), // 'active' | 'completed'
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});
