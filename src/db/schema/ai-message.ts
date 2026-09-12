import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './user';

/**
 * The user's AI conversation, persisted server-side.
 *
 * A single rolling thread per user — which is what the UI has always shown.
 * A conversations table can come later if multi-thread is ever wanted; adding
 * one now would be structure with no feature behind it.
 *
 * **This is a security fix as much as a feature.** The chat used to be held
 * only in React state and posted back with every turn, and `runChat` read the
 * pending medication proposal out of that client-supplied history. A crafted
 * request could therefore present a `pendingAction` that the assistant had
 * never proposed and have `create_medication` execute against it. Reading the
 * pending action from this table instead means the two-step confirm actually
 * confirms something the server itself said.
 */
export const aiMessages = pgTable(
  'ai_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** 'user' | 'assistant' */
    role: varchar('role', { length: 20 }).notNull(),
    content: text('content').notNull(),
    /**
     * The tool call this assistant turn proposed and is waiting on
     * confirmation for. Only ever written by the server.
     */
    pendingAction: jsonb('pending_action'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('ai_messages_user_created_idx').on(table.userId, table.createdAt),
  ],
);
