import { pgTable, uuid, varchar } from 'drizzle-orm/pg-core';

export const countries = pgTable('countries', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  // Unique: the seeder upserts on this column, and without the constraint a
  // re-run appends the whole list again (which produced 68 duplicate rows).
  code: varchar('code', { length: 10 }).notNull().unique(),
  callCode: varchar('call_code', { length: 10 }).notNull(),
});
