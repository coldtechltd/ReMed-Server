import 'dotenv/config';
import { Pool } from 'pg';
import { countryData } from './country-data';

/**
 * One-off, idempotent repair for duplicated `countries` rows.
 *
 * `seed-countries.ts` originally ran a bare `insert` against a table whose only
 * constraint was the primary key on `id`, so every run appended the entire list
 * again. A second run against an older, shorter list left 240 rows spanning 172
 * codes — 68 duplicates, surfaced to users as a country picker listing
 * "Afghanistan" twice.
 *
 * The repair, in one transaction:
 *   1. pick one canonical row per code, preferring a row a profile already
 *      points at so most references need no rewrite;
 *   2. repoint `profiles.country_id` off every row about to be removed;
 *   3. delete the non-canonical rows;
 *   4. align survivors with country-data.ts (this is what promotes Bahamas from
 *      the stale "+1" to "+1-242") and insert any code that is missing;
 *   5. add the unique constraint on `code` that should have been there from the
 *      start, which is also the conflict target the rewritten seeder upserts on.
 *
 * Safe to re-run: a clean table produces zero updates and zero deletes.
 *
 *   npx tsx src/db/seeder/dedupe-countries.ts             # apply
 *   npx tsx src/db/seeder/dedupe-countries.ts --dry-run   # preview, then roll back
 */

type CountryRow = { id: string; code: string; name: string; call_code: string };

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: before } = await client.query<CountryRow>(
      'select id, code, name, call_code from countries order by code, id',
    );
    const { rows: refRows } = await client.query<{ country_id: string | null }>(
      'select country_id from profiles where country_id is not null',
    );
    const referenced = new Set(refRows.map((r) => r.country_id as string));

    console.log(
      `before: ${before.length} rows, ${new Set(before.map((r) => r.code)).size} distinct codes, ` +
        `${referenced.size} referenced by profiles`,
    );

    // 1. Canonical row per code. A referenced row wins so that existing
    //    profiles keep pointing where they already do; `id` breaks ties so the
    //    choice is deterministic across runs.
    const byCode = new Map<string, CountryRow[]>();
    for (const row of before) {
      const list = byCode.get(row.code) ?? [];
      list.push(row);
      byCode.set(row.code, list);
    }

    const keepIdByCode = new Map<string, string>();
    const staleToKeep: Array<{ oldId: string; keepId: string }> = [];

    for (const [code, rows] of byCode) {
      const ranked = [...rows].sort((a, b) => {
        const aRef = referenced.has(a.id) ? 0 : 1;
        const bRef = referenced.has(b.id) ? 0 : 1;
        return aRef !== bRef ? aRef - bRef : a.id.localeCompare(b.id);
      });
      const [keep, ...stale] = ranked;
      keepIdByCode.set(code, keep.id);
      for (const row of stale) staleToKeep.push({ oldId: row.id, keepId: keep.id });
    }

    if (staleToKeep.length === 0) {
      console.log('no duplicate rows — nothing to collapse');
    }

    // 2. Repoint profiles off the rows that are about to disappear. Must run
    //    before the delete: countries.id is a live foreign key target.
    const repointed = await client.query(
      `update profiles p
          set country_id = m.keep_id
         from unnest($1::uuid[], $2::uuid[]) as m(old_id, keep_id)
        where p.country_id = m.old_id`,
      [staleToKeep.map((m) => m.oldId), staleToKeep.map((m) => m.keepId)],
    );
    console.log(`repointed profiles: ${repointed.rowCount}`);

    // 3. Remove the duplicates.
    const deleted = await client.query(
      'delete from countries where id = any($1::uuid[])',
      [staleToKeep.map((m) => m.oldId)],
    );
    console.log(`deleted duplicate rows: ${deleted.rowCount}`);

    // 4. Bring survivors in line with the canonical list, then add anything
    //    missing. Only rows that actually differ are touched.
    const codes = countryData.map((c) => c.code);
    const names = countryData.map((c) => c.name);
    const calls = countryData.map((c) => c.callCode);

    const realigned = await client.query(
      `update countries c
          set name = d.name, call_code = d.call_code
         from unnest($1::text[], $2::text[], $3::text[]) as d(code, name, call_code)
        where c.code = d.code
          and (c.name is distinct from d.name or c.call_code is distinct from d.call_code)`,
      [codes, names, calls],
    );
    console.log(`realigned rows to country-data.ts: ${realigned.rowCount}`);

    const inserted = await client.query(
      `insert into countries (name, code, call_code)
       select d.name, d.code, d.call_code
         from unnest($1::text[], $2::text[], $3::text[]) as d(code, name, call_code)
        where not exists (select 1 from countries c where c.code = d.code)`,
      [codes, names, calls],
    );
    console.log(`inserted missing codes: ${inserted.rowCount}`);

    // 5. The constraint that prevents all of this happening again. Named to
    //    match what drizzle generates for `.unique()` on countries.code, so a
    //    later `db:push` sees the schema and the database as already in sync.
    await client.query(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint where conname = 'countries_code_unique'
        ) then
          alter table countries add constraint countries_code_unique unique (code);
        end if;
      end
      $$;
    `);

    // Verify inside the transaction, so a bad result rolls back.
    const { rows: after } = await client.query<{ total: string; codes: string }>(
      'select count(*) total, count(distinct code) codes from countries',
    );
    const { rows: orphans } = await client.query<{ n: string }>(
      `select count(*) n from profiles p
        where p.country_id is not null
          and not exists (select 1 from countries c where c.id = p.country_id)`,
    );

    const total = Number(after[0].total);
    const distinct = Number(after[0].codes);
    const orphanCount = Number(orphans[0].n);

    if (total !== distinct) {
      throw new Error(`duplicates remain: ${total} rows across ${distinct} codes`);
    }
    if (orphanCount > 0) {
      throw new Error(`${orphanCount} profile(s) left pointing at a deleted country`);
    }
    if (total !== countryData.length) {
      throw new Error(
        `expected ${countryData.length} rows to match country-data.ts, found ${total}`,
      );
    }

    console.log(`after: ${total} rows, ${distinct} distinct codes, ${orphanCount} orphaned profiles`);

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('🔍 dry run — every change above was rolled back');
      return;
    }

    await client.query('COMMIT');
    console.log('✅ countries de-duplicated');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ de-dupe failed, transaction rolled back');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
