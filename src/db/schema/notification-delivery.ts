import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './user';

/**
 * One row per push message we hand to Expo, and what became of it.
 *
 * An Expo *ticket* only says Expo accepted the message; the real delivery
 * outcome arrives minutes later in a *receipt*. Neither was ever persisted, so
 * the reliability SLO ("95% of reminders delivered within 2 min") was literally
 * unmeasurable, and support had no answer to "why didn't I get my reminder?" —
 * the in-memory receipt queue is per-instance and vanishes on restart.
 *
 * Status moves accepted -> delivered | failed (or straight to `rejected` when
 * Expo refuses the ticket outright).
 *
 * Deliberately does NOT store notification body text: these rows are diagnostic
 * and the body names the user's medication, which is exactly the health data
 * the rest of the stack works to keep out of logs.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** 'dose_reminder' | 'refill_reminder' | 'companion_missed_dose' | 'companion_refill' */
    category: varchar('category', { length: 50 }).notNull(),
    /** The dose event or dosage form this push was about, for support lookups. */
    refId: uuid('ref_id'),
    pushToken: varchar('push_token', { length: 255 }),
    /** Expo ticket id — null when Expo rejected the message outright. */
    ticketId: varchar('ticket_id', { length: 255 }),
    /** 'accepted' | 'rejected' | 'delivered' | 'failed' */
    status: varchar('status', { length: 20 }).notNull(),
    /** Expo's error code, e.g. DeviceNotRegistered / MessageRateExceeded. */
    errorCode: varchar('error_code', { length: 100 }),
    sentAt: timestamp('sent_at').defaultNow().notNull(),
    /** When the receipt resolved the row. Sent→resolved is the delivery latency. */
    resolvedAt: timestamp('resolved_at'),
  },
  (table) => [
    index('notification_deliveries_user_sent_idx').on(
      table.userId,
      table.sentAt,
    ),
    index('notification_deliveries_ticket_idx').on(table.ticketId),
  ],
);
