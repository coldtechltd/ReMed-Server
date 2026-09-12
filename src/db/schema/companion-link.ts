import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './user';

/**
 * A read-only grant from one user (the owner) to another (the companion), so a
 * caregiver can watch someone's doses and get missed-dose / refill alerts.
 *
 * The row is also the consent record for the share: `acceptedAt` is the moment
 * the companion redeemed the owner's code, `revokedAt` is either side
 * withdrawing. (Terms/Privacy acceptance is separate and already captured in
 * consent_records at signup.)
 *
 * Rows are created at redemption and are `active` from birth — the pending
 * half-state belonged to the single-use invite model this replaced, where a row
 * existed from the moment the owner generated a code. The sharing code now
 * lives in its own table (`companion_codes`) and is not per-link, so there is
 * nothing to record until someone actually joins.
 */
export const companionLinks = pgTable(
  'companion_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .references(() => users.id)
      .notNull(),
    // Nullable only because legacy pending rows predate the persistent-code
    // model; every row this code path creates has a companion.
    companionId: uuid('companion_id').references(() => users.id),
    // The owner's nickname for this companion ("Mum"), set after they join.
    // Falls back to their profile name in the API response.
    label: varchar('label', { length: 100 }),
    // Only 'viewer' is implemented. Present so a future write-capable role
    // ('caregiver') is an additive change rather than a migration.
    role: varchar('role', { length: 20 }).notNull().default('viewer'),
    // active | revoked. 'pending' is legacy — see the note above.
    status: varchar('status', { length: 20 }).notNull().default('active'),
    notifyMissedDose: boolean('notify_missed_dose').default(true).notNull(),
    notifyRefill: boolean('notify_refill').default(true).notNull(),
    invitedAt: timestamp('invited_at').defaultNow(),
    acceptedAt: timestamp('accepted_at'),
    revokedAt: timestamp('revoked_at'),
    // Either side can revoke, so record which one did.
    revokedBy: uuid('revoked_by'),
    lastViewedAt: timestamp('last_viewed_at'),
  },
  (table) => [
    // "who am I sharing with" (owner's management screen + the entitlement count)
    index('companion_links_owner_status_idx').on(table.ownerId, table.status),
    // "whose data may I read" (access guard + the companion's own list)
    index('companion_links_companion_status_idx').on(
      table.companionId,
      table.status,
    ),
    // One live link per pair. Partial, so revoked history is still allowed and
    // someone can be re-added after being removed.
    uniqueIndex('companion_links_active_pair_idx')
      .on(table.ownerId, table.companionId)
      .where(sql`${table.status} = 'active'`),
  ],
);
