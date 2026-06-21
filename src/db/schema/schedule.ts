
import {
  pgTable,
  uuid,
  integer,
  timestamp,
  boolean,
  varchar,
  text,
} from 'drizzle-orm/pg-core';
import { dosageForms } from './dosageForm';

export const schedules = pgTable('schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  dosageFormId: uuid('dosage_form_id')
    .references(() => dosageForms.id)
    .notNull(),
  type: varchar('type', { length: 50 }).notNull(), // 'interval', 'specific_times', 'as_needed'
  // For interval schedules
  intervalValue: integer('interval_value'),
  intervalUnit: varchar('interval_unit', { length: 20 }), // 'minutes', 'hours', 'days'
  // For specific times (e.g. ["08:00", "20:00"])
  specificTimes: text('specific_times').array(),
  // For specific days (e.g. ["Mon", "Wed", "Fri"])
  daysOfWeek: text('days_of_week').array(),
  
  firstDoseAt: timestamp('first_dose_at'),
  // IANA timezone (e.g. "Africa/Lagos") the specific_times are expressed in,
  // captured from the user's device. Used to compute correct UTC dose instants.
  timezone: varchar('timezone', { length: 64 }).default('UTC'),
  asNeeded: boolean('as_needed').default(false),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});
