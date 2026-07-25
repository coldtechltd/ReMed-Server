import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';

/**
 * One-off backfill for the medications.type / status / completed_at columns added
 * in migration 0005.
 *
 * This exists as a script because `drizzle-kit push` — the apply path this project
 * actually uses — diffs the schema and ignores the SQL in drizzle/, so the UPDATE
 * statements in the migration file never run. Run this once, immediately after
 * pushing 0005:
 *
 *   npx tsx src/db/seeder/backfill-medication-lifecycle.ts
 *
 * Idempotent: re-running only touches rows still holding the column defaults.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function backfill() {
  console.log('💊 Backfilling medication type/status...');

  // Existing rows predate the type column, so derive it from the only signal they
  // had: whether an end date was set.
  const typed = await db.execute(sql`
    UPDATE medications
       SET type = CASE WHEN end_date IS NULL THEN 'continuous' ELSE 'course' END
     WHERE type = 'continuous' AND end_date IS NOT NULL
  `);
  console.log(`   → ${typed.rowCount ?? 0} row(s) marked as 'course'`);

  // Retire courses that already finished. The 36-hour margin is the same
  // timezone-safety guard the auto-complete cron applies: end_date is inclusive
  // through end-of-day in the schedule's timezone, which can be up to ~35h after
  // the stored midnight-UTC timestamp for users west of UTC. Courses inside that
  // window are left active and the nightly cron picks them up a few hours later.
  const completed = await db.execute(sql`
    UPDATE medications
       SET status = 'completed', completed_at = end_date
     WHERE status = 'active'
       AND end_date IS NOT NULL
       AND end_date < now() - interval '36 hours'
  `);
  console.log(`   → ${completed.rowCount ?? 0} finished course(s) completed`);

  console.log('✅ Backfill complete');
  process.exit(0);
}

backfill().catch((err) => {
  console.error('❌ Backfill failed', err);
  process.exit(1);
});
