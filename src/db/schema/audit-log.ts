import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Persisted trail of every mutation and every access to sensitive resources
 * (written by AuditInterceptor). `userId` is deliberately NOT a foreign key:
 * audit rows must survive account deletion — the deletion itself is the last
 * entry an account leaves behind.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id'),
    method: varchar('method', { length: 10 }).notNull(),
    url: text('url').notNull(),
    action: varchar('action', { length: 20 }).notNull(),
    ip: varchar('ip', { length: 64 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_user_idx').on(table.userId),
    index('audit_logs_created_idx').on(table.createdAt),
  ],
);
