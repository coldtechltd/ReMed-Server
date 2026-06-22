import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  boolean,
} from 'drizzle-orm/pg-core';
import { medications } from './medication';

export const dosageForms = pgTable('dosage_forms', {
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
  refillThreshold: integer('refill_threshold').default(5), // alert at/below this
  lowStockAlertSent: boolean('low_stock_alert_sent').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});
