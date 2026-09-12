import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { medicationNames } from '../schema';
import { MEDICATION_NAMES } from './medication-names.data';

/**
 * Seeds the medication-name autocomplete list.
 *
 * A standalone script rather than SQL in a migration because `db:push` diffs
 * the schema against the database and never executes `drizzle/*.sql`, so any
 * data statement written there would silently never run.
 *
 *   npx tsx src/db/seeder/seed-medication-names.ts
 *
 * Idempotent: conflicts on `name` update the generic mapping, so re-running
 * after editing medication-names.data.ts corrects existing rows rather than
 * duplicating or skipping them.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function seed() {
  console.log(`💊 Seeding ${MEDICATION_NAMES.length} medication names...`);

  const rows = MEDICATION_NAMES.map(([name, genericName]) => ({
    name,
    genericName,
    source: 'curated',
  }));

  // One statement rather than 350 round trips.
  const result = await db
    .insert(medicationNames)
    .values(rows)
    .onConflictDoUpdate({
      target: medicationNames.name,
      set: {
        genericName: sql`excluded.generic_name`,
        source: sql`excluded.source`,
      },
    })
    .returning({ id: medicationNames.id });

  console.log(`   → ${result.length} row(s) inserted or updated`);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(medicationNames);
  console.log(`   → ${total} name(s) now in the table`);
  console.log('✅ Seed complete');

  await pool.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed', err);
  process.exit(1);
});
