import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';

/**
 * One-off repair for `dosage_forms.refill_reminder_sent_at`.
 *
 * The column started life as a boolean "already reminded" flag and became a
 * timestamp when the refill throttle moved to a per-day window. `drizzle-kit
 * push` cannot apply that change on its own: Postgres refuses to cast boolean
 * to timestamp without an explicit USING clause, so the push aborts — and
 * because push is not transactional, it dies *mid-run*, leaving every later
 * statement (all six of the performance indexes) unapplied. Any push against
 * this database fails at the same spot until this script has run.
 *
 * Until then the column is also actively broken at runtime: the daily refill
 * cron compares it with `lt(..., throttleCutoff)` and writes `new Date()` into
 * it, neither of which a boolean column accepts.
 *
 *   npx tsx src/db/seeder/fix-refill-reminder-column.ts
 *   npm run db:push        # now completes, creating the indexes
 *
 * Idempotent: it inspects the live column type first and does nothing once the
 * column is already a timestamp.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function fix() {
  const { rows } = await db.execute<{ data_type: string }>(sql`
    SELECT data_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'dosage_forms'
       AND column_name = 'refill_reminder_sent_at'
  `);

  if (rows.length === 0) {
    console.error(
      '❌ dosage_forms.refill_reminder_sent_at not found — run db:push first.',
    );
    process.exit(1);
  }

  const type = rows[0].data_type;
  if (type !== 'boolean') {
    console.log(`✅ Already '${type}' — nothing to do.`);
    process.exit(0);
  }

  console.log('🔧 Converting refill_reminder_sent_at from boolean → timestamp…');

  // `true` meant "a reminder has gone out", with no record of when. Mapping it
  // to now() keeps the throttle closed for the usual one-day window rather than
  // re-alerting every affected user the next time the 09:00 cron runs; `false`
  // becomes NULL, which is the re-armed state the code already expects.
  await db.execute(sql`
    ALTER TABLE dosage_forms
      ALTER COLUMN refill_reminder_sent_at DROP DEFAULT,
      ALTER COLUMN refill_reminder_sent_at TYPE timestamp
        USING (CASE WHEN refill_reminder_sent_at THEN now()::timestamp END)
  `);

  const { rows: after } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
      FROM dosage_forms
     WHERE refill_reminder_sent_at IS NOT NULL
  `);

  console.log(
    `✅ Converted. ${after[0].n} row(s) carry a throttle timestamp; the rest are re-armed.`,
  );
  process.exit(0);
}

fix().catch((err) => {
  console.error('❌ Conversion failed', err);
  process.exit(1);
});
