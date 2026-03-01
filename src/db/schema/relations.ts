import { relations } from 'drizzle-orm';
import { users } from './user';
import { profiles } from './profile';
import { medications } from './medication';
import { dosageForms } from './dosageForm';
import { schedules } from './schedule';
import { doseEvents } from './doseEvent';
import { countries } from './country';

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, {
    fields: [users.id],
    references: [profiles.userId],
  }),
  medications: many(medications),
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
