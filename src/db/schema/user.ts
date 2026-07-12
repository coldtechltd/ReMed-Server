import { pgTable, uuid, varchar, timestamp, text } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }),

  // OAuth fields
  oauthProvider: varchar('oauth_provider', { length: 50 }), // e.g., 'google', 'github', 'apple'
  oauthId: varchar('oauth_id', { length: 255 }), // Provider-specific user ID
  oauthAccessToken: text('oauth_access_token'), // OAuth access token
  oauthRefreshToken: text('oauth_refresh_token'), // OAuth refresh token (if available)
  oauthTokenExpiresAt: timestamp('oauth_token_expires_at'), // When access token expires

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
