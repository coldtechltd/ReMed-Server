import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './user';

/**
 * Proof of which Terms/Privacy version a user accepted and when. Written at
 * signup (and again whenever acceptance is re-collected after a legal-content
 * update). `version` is the LAST_UPDATED string from legal.content.ts, so
 * bumping the documents naturally versions future consents.
 */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    document: varchar('document', { length: 20 }).notNull(), // 'terms' | 'privacy'
    version: varchar('version', { length: 100 }).notNull(),
    acceptedAt: timestamp('accepted_at').defaultNow().notNull(),
  },
  (table) => [index('consent_records_user_idx').on(table.userId)],
);
