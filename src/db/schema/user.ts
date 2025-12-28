import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  integer,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  expoPushToken: varchar('expo_push_token', { length: 255 }), // For Expo notifications

  // OAuth fields
  oauthProvider: varchar('oauth_provider', { length: 50 }), // e.g., 'google', 'github', 'apple'
  oauthId: varchar('oauth_id', { length: 255 }), // Provider-specific user ID
  oauthAccessToken: text('oauth_access_token'), // OAuth access token
  oauthRefreshToken: text('oauth_refresh_token'), // OAuth refresh token (if available)
  oauthTokenExpiresAt: timestamp('oauth_token_expires_at'), // When access token expires

  // Token versioning for logout management
  tokenVersion: integer('token_version').default(0),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
