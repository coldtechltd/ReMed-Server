import {
  integer,
  pgTable,
  uuid,
  varchar,
  date,
  timestamp,
} from 'drizzle-orm/pg-core';
import { users } from './user';

export const profiles = pgTable('profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  dateOfBirth: date('date_of_birth'),
  bloodGroup: varchar('blood_group', { length: 10 }),
  genotype: varchar('genotype', { length: 10 }),
  height: integer('height'), // in cm
  weight: integer('weight'), // in kg
  gender: varchar('gender', { length: 50 }),
  country: varchar('country', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow(),
});
