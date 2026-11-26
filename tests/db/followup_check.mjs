// Checks the follow-up schedule and 90-day re-hit rule in the database (migration 028).
// Runs on an in-process PostgreSQL build (PGlite) with every migration applied. Does not touch the live database.
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIG = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const db = await PGlite.create({ extensions: { uuid_ossp } });
const run = async (sql, params) => (await db.query(sql, params)).rows;
const ignore = (p) => p.catch(() => {});

await ignore(db.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'));
for (const s of [
  'CREATE SCHEMA IF NOT EXISTS auth',
  'CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)',
  "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$",
  "CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$",
  'CREATE ROLE authenticated',
  'CREATE ROLE anon',
]) await ignore(db.exec(s));

for (const f of fs.readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) {
  if (f.startsWith('003_')) continue;
  const sql = fs.readFileSync(`${MIG}/${f}`, 'utf8').replace(/CREATE EXTENSION[^;]*pg_trgm[^;]*;/g, '').replace(/gin_trgm_ops/g, '');
  try {
    await db.exec(sql);
  } catch (e) {
    await ignore(db.exec('ROLLBACK'));
    console.log('migration failed:', f, String(e.message).slice(0, 120));
  }
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};

// One property per case. days = how long ago the last contact was (null = never contacted).
const cases = [
  { apn: 'FU-RECENT', marketing: 'contacted', contacts: 1, days: 3, expect: 'contacted_1' },
  { apn: 'FU-DUE', marketing: 'contacted', contacts: 1, days: 8, expect: 'followup_due' },
  { apn: 'FU-LIMIT', marketing: 'contacted', contacts: 3, days: 30, expect: 'contacted_3' },
  { apn: 'FU-REHIT', marketing: 'contacted', contacts: 3, days: 95, expect: 'rehit_due' },
  { apn: 'FU-RESPONDER', marketing: 'responded', contacts: 2, days: 120, expect: 'contacted_2' },
  { apn: 'FU-OPTOUT', marketing: 'opted_out', contacts: 1, days: 120, expect: 'opted_out' },
  { apn: 'FU-WRONG', marketing: 'wrong_number', contacts: 1, days: 120, expect: 'wrong_number' },
  { apn: 'FU-NEVER', marketing: 'never_contacted', contacts: 0, days: null, expect: 'never_marketed' },
];

for (const c of cases) {
  await db.query(
    `INSERT INTO properties (internal_id, source, state, county, apn_raw, marketing_status, total_contacts, last_contacted_at)
     VALUES ($1, 'land_portal', 'FL', 'Rusk', $1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() - ($4::int * interval '1 day') END)`,
    [c.apn, c.marketing, c.contacts, c.days],
  );
}

const statusOf = async (apn) => (await run(`SELECT app_marketing_status(marketing_status, total_contacts, last_contacted_at) AS s FROM properties WHERE apn_raw = $1`, [apn]))[0].s;
for (const c of cases) {
  const got = await statusOf(c.apn);
  check(`status for ${c.apn}`, got === c.expect, `(expected ${c.expect}, got ${got})`);
}

// The Properties screen and the Command Center read the same status.
const searchStatus = async (status) => (await run(`SELECT apn FROM search_properties(NULL, $1, NULL, NULL, 'owner', 'asc', 100, 0, NULL)`, [status])).map((r) => r.apn);
check('search filter shows the re-hit property', (await searchStatus('rehit_due')).join() === 'FU-REHIT');
check('search filter shows the follow-up property', (await searchStatus('followup_due')).join() === 'FU-DUE');
const shown = (await run(`SELECT status FROM search_properties(NULL, NULL, NULL, NULL, 'owner', 'asc', 100, 0, NULL) WHERE apn = 'FU-REHIT'`))[0];
check('search row carries the re-hit status', shown?.status === 'rehit_due');

const summary = (await run(`SELECT dashboard_summary() AS s`))[0].s;
check('dashboard counts one re-hit due', summary.rehit_due === 1, JSON.stringify({ rehit_due: summary.rehit_due }));
check('dashboard counts one follow-up due', summary.followup_due === 1, JSON.stringify({ followup_due: summary.followup_due }));

// Once a re-hit happens, the 90-day clock starts again: a new contact moves the property out of the re-hit queue.
await db.query(`UPDATE properties SET total_contacts = total_contacts + 1, last_contacted_at = now() WHERE apn_raw = 'FU-REHIT'`);
check('a new contact clears the re-hit', (await statusOf('FU-REHIT')) === 'contacted_3');

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
await db.close();
if (failed > 0) process.exitCode = 1;
