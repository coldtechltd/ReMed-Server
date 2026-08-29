import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { countries } from '../schema';
import { countryData } from './country-data';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool);

async function seed() {
  console.log('🌍 Seeding countries...');

  // Upsert on `code`, not a bare insert. The original version appended the
  // whole list on every run, which is how the table ended up with 240 rows
  // across 172 codes. The unique constraint added by dedupe-countries.ts is
  // what makes this conflict target valid.
  const result = await db
    .insert(countries)
    .values(countryData)
    .onConflictDoUpdate({
      target: countries.code,
      set: {
        name: sql`excluded.name`,
        callCode: sql`excluded.call_code`,
      },
    });

  console.log(`✅ Countries seeded (${countryData.length} rows upserted)`);
  await pool.end();
  process.exit(0);
}

seed().catch(async (err) => {
  console.error('❌ Seeding failed', err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
