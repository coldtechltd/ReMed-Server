import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { medications } from './medication';

export const dosageForms = pgTable(
  'dosage_forms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    medicationId: uuid('medication_id')
      .references(() => medications.id)
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(), // e.g. "Paracetamol"
    type: varchar('type', { length: 100 }).notNull(), // e.g. "pill", "injection"
    dosageAmount: integer('dosage_amount').notNull(), // e.g. 2
    dosageUnit: varchar('dosage_unit', { length: 50 }).default('pills'),
    route: varchar('route', { length: 100 }).default('oral'),
    quantityOnHand: integer('quantity_on_hand'), // null = stock not tracked
    refillThreshold: integer('refill_threshold').default(5), // fallback when stock can't be projected
    // Latch stopping the daily refill cron from re-alerting every morning. Re-armed
    // (set back to null) whenever the user updates quantityOnHand, i.e. restocks.
    refillReminderSentAt: timestamp('refill_reminder_sent_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [index('dosage_forms_medication_id_idx').on(table.medicationId)],
);
