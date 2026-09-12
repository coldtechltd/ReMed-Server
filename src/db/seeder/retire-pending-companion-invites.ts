import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';

/**
 * One-off cleanup for the move from single-use invites to persistent companion
 * codes (migration 0011).
 *
 * Under the old model a `pending` row was created the moment an owner generated
 * an invite, and carried the code's hash. Migration 0011 drops `invite_code_hash`
 * and `expires_at`, which leaves those rows unredeemable: no code can ever match
 * them again. They are already invisible — every query now filters on
 * `status = 'active'` — but leaving half-finished consent records lying about in
 * a health app is not something to do on purpose, so they are closed out
 * explicitly with an audit trail rather than left to rot.
 *
 * This is a script rather than SQL in the migration because `drizzle-kit push` —
 * the apply path this project uses — diffs the schema and ignores drizzle/*.sql,
 * so data statements written there never execute. Run it once, right after
 * pushing 0011:
 *
 *   npx tsx src/db/seeder/retire-pending-companion-invites.ts
 *
 * Idempotent: only rows still sitting at 'pending' are touched, and there is no
 * longer any code path that creates one.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function retire() {
  console.log('🤝 Retiring unredeemable companion invites...');

  // revoked_by stays null on purpose: nobody withdrew these. The null is the
  // signal that the system closed them, not the owner or the invitee.
  const retired = await db.execute(sql`
    UPDATE companion_links
       SET status = 'revoked', revoked_at = now()
     WHERE status = 'pending'
  `);
  console.log(`   → ${retired.rowCount ?? 0} pending invite(s) closed`);

  // Owners whose only "companion" was one of those pending invites now show an
  // empty sharing list, which is correct: nobody ever accepted. They keep their
  // seats, since seats are counted from active links only.
  console.log('✅ Cleanup complete');
  process.exit(0);
}

retire().catch((err) => {
  console.error('❌ Cleanup failed', err);
  process.exit(1);
});
