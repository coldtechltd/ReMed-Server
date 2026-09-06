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
 * The row is also the consent record for the share: `invitedAt` is the owner
 * granting it, `acceptedAt` is the companion accepting, `revokedAt` is either
 * side withdrawing. (Terms/Privacy acceptance is separate and already captured
 * in consent_records at signup.)
 *
 * A link is `pending` until redeemed: `companionId` is null and the invite code
 * exists only as a hash, so a database leak can't be replayed into access.
 */
export const companionLinks = pgTable(
  'companion_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .references(() => users.id)
      .notNull(),
    // Null until the invite is accepted — a pending invite has no recipient yet.
    companionId: uuid('companion_id').references(() => users.id),
    // sha256 hex of the invite code, nulled once redeemed. The plaintext code is
    // returned to the owner exactly once, at creation.
    inviteCodeHash: varchar('invite_code_hash', { length: 64 }),
    // The owner's nickname for the invitee ("Mum"), shown before they accept —
    // until then there is no profile to read a name from.
    label: varchar('label', { length: 100 }),
    // Only 'viewer' is implemented. Present so a future write-capable role
    // ('caregiver') is an additive change rather than a migration.
    role: varchar('role', { length: 20 }).notNull().default('viewer'),
    status: varchar('status', { length: 20 }).notNull().default('pending'), // pending | active | revoked
    notifyMissedDose: boolean('notify_missed_dose').default(true).notNull(),
    notifyRefill: boolean('notify_refill').default(true).notNull(),
    invitedAt: timestamp('invited_at').defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
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
    // Invite redemption is a lookup by hash.
    index('companion_links_code_idx').on(table.inviteCodeHash),
    // One live link per pair. Partial, so revoked history and multiple pending
    // invites (which have a null companionId) are still allowed.
    uniqueIndex('companion_links_active_pair_idx')
      .on(table.ownerId, table.companionId)
      .where(sql`${table.status} = 'active'`),
  ],
);
