import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const conditions = pgTable('conditions', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});
