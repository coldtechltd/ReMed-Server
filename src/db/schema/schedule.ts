import {
  pgTable,
  uuid,
  integer,
  timestamp,
  boolean,
} from 'drizzle-orm/pg-core';
import { dosageForms } from './dosageForm';

export const schedules = pgTable('schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  dosageFormId: uuid('dosage_form_id')
    .references(() => dosageForms.id)
    .notNull(),
  intervalHours: integer('interval_hours').notNull(), // every 8 hours
  nextDoseAt: timestamp('next_dose_at').notNull(),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});
