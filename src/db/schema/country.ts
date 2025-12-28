import { pgTable, uuid, varchar } from 'drizzle-orm/pg-core';

export const countries = pgTable('countries', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 10 }).notNull(),
  callCode: varchar('call_code', { length: 10 }).notNull(),
});
