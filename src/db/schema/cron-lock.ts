import { pgTable, varchar, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Claim-based cron dedup for multi-replica deployments. Every cron decorator
 * runs in-process on every instance; before doing any work, each instance
 * INSERTs a claim for (job name, current period bucket) with ON CONFLICT DO
 * NOTHING — only the instance whose insert lands runs the job. Works through
 * any connection pool (unlike session advisory locks) and doubles as a "last
 * ran at" record. Old rows are pruned opportunistically by the claimer.
 */
export const cronLocks = pgTable(
  'cron_locks',
  {
    name: varchar('name', { length: 100 }).notNull(),
    periodStart: timestamp('period_start').notNull(),
    claimedAt: timestamp('claimed_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.name, table.periodStart] })],
);
