import { relations } from 'drizzle-orm';
import { users } from './user';
import { deviceSessions } from './device-session';
import { profiles } from './profile';
import { medications } from './medication';
import { dosageForms } from './dosageForm';
import { schedules } from './schedule';
import { doseEvents } from './doseEvent';
import { countries } from './country';
import { companionLinks } from './companion-link';

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, {
    fields: [users.id],
    references: [profiles.userId],
  }),
  medications: many(medications),
  deviceSessions: many(deviceSessions),
  // Two self-referential edges, so they need explicit relation names to tell
  // drizzle which FK each side belongs to.
  sharedWith: many(companionLinks, { relationName: 'owner' }),
  following: many(companionLinks, { relationName: 'companion' }),
}));

export const companionLinksRelations = relations(companionLinks, ({ one }) => ({
  owner: one(users, {
    fields: [companionLinks.ownerId],
    references: [users.id],
    relationName: 'owner',
  }),
  companion: one(users, {
    fields: [companionLinks.companionId],
    references: [users.id],
    relationName: 'companion',
  }),
}));

export const deviceSessionsRelations = relations(deviceSessions, ({ one }) => ({
  user: one(users, {
    fields: [deviceSessions.userId],
    references: [users.id],
  }),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, {
    fields: [profiles.userId],
    references: [users.id],
  }),
  country: one(countries, {
    fields: [profiles.countryId],
    references: [countries.id],
  }),
}));

export const countriesRelations = relations(countries, ({ many }) => ({
  profiles: many(profiles),
}));

export const medicationsRelations = relations(medications, ({ one, many }) => ({
  user: one(users, {
    fields: [medications.userId],
    references: [users.id],
  }),
  dosageForms: many(dosageForms),
}));

export const dosageFormsRelations = relations(dosageForms, ({ one, many }) => ({
  medication: one(medications, {
    fields: [dosageForms.medicationId],
    references: [medications.id],
  }),
  schedules: many(schedules),
}));

export const schedulesRelations = relations(schedules, ({ one, many }) => ({
  dosageForm: one(dosageForms, {
    fields: [schedules.dosageFormId],
    references: [dosageForms.id],
  }),
  doseEvents: many(doseEvents),
}));

export const doseEventsRelations = relations(doseEvents, ({ one }) => ({
  schedule: one(schedules, {
    fields: [doseEvents.scheduleId],
    references: [schedules.id],
  }),
}));
