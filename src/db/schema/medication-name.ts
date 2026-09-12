import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Reference list of medication names, for autocomplete in the creation wizard.
 *
 * Medication names were free text, which made every downstream comparison
 * guesswork: "Panadol" and "panadol " and "Paracetamol" were three different
 * medications as far as duplicate detection and allergy matching were
 * concerned. Offering a canonical name at entry is what makes those features
 * possible at all.
 *
 * Seeded from a curated list rather than a live RxNorm/openFDA query on
 * purpose: the wizard must work offline, a third-party lookup would add
 * latency to the most important form in the app, and the licensing story for
 * redistributing a full drug database is its own project. `source` exists so
 * an API-backed set can be added alongside the curated one later without a
 * migration.
 */
export const medicationNames = pgTable(
  'medication_names',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** The name as the user would type it — generic or brand. */
    name: varchar('name', { length: 255 }).notNull().unique(),
    /**
     * The active ingredient. For a generic row this repeats `name`; for a
     * brand row it points at the generic, which is what lets duplicate-therapy
     * detection notice that Panadol and Paracetamol are the same drug.
     */
    genericName: varchar('generic_name', { length: 255 }),
    /** 'curated' | 'rxnorm' — provenance, for a future API-backed set. */
    source: varchar('source', { length: 50 }).default('curated').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('medication_names_name_idx').on(table.name),
    index('medication_names_generic_idx').on(table.genericName),
  ],
);
