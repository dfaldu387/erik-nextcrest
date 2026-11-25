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
  try { await db.exec(sql); } catch (e) { await ignore(db.exec('ROLLBACK')); console.log('migration failed:', f, String(e.message).slice(0, 120)); }
}

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const DM = '11111111-1111-1111-1111-111111111111';
const VIEWER = '22222222-2222-2222-2222-222222222222';
await db.exec(`INSERT INTO auth.users (id) VALUES ('${DM}'), ('${VIEWER}')`);
await db.exec(`INSERT INTO profiles (id, role, email) VALUES ('${DM}', 'data_manager', 'dm@t.local'), ('${VIEWER}', 'user', 'v@t.local')`);

const batch = (await run(`INSERT INTO import_batches (filename, source, purchase_date, total_rows, new_rows, status, created_by)
  VALUES ('bad.csv','land_portal','2026-11-24',2,2,'completed',$1) RETURNING id`, [DM]))[0].id;
const other = (await run(`INSERT INTO import_batches (filename, source, purchase_date, total_rows, new_rows, status, created_by)
  VALUES ('keep.csv','land_portal','2026-11-24',1,1,'completed',$1) RETURNING id`, [DM]))[0].id;
const p1 = (await run(`INSERT INTO properties (internal_id, source, state, county, import_batch_id) VALUES ('X-1','land_portal','FL','Rusk',$1) RETURNING id`, [batch]))[0].id;
await run(`INSERT INTO properties (internal_id, source, state, county, import_batch_id) VALUES ('X-2','land_portal','FL','Rusk',$1)`, [batch]);
await run(`INSERT INTO properties (internal_id, source, state, county, import_batch_id) VALUES ('K-1','land_portal','FL','Hardee',$1)`, [other]);
await run(`INSERT INTO property_owners (property_id, last_name, owner_sequence) VALUES ($1,'Doe',1)`, [p1]);
const count = async (sql) => Number((await run(sql))[0].n);

await db.exec(`SELECT set_config('request.jwt.claim.sub', '${VIEWER}', false)`);
const denied = await db.query(`SELECT discard_import_batch($1) AS r`, [batch]).then(() => null, (e) => e.message);
check('plain user is refused', !!denied && /cannot discard/.test(denied), denied ?? '');
check('refused discard removes nothing', (await count(`SELECT count(*)::int AS n FROM properties`)) === 3);

await db.exec(`SELECT set_config('request.jwt.claim.sub', '${DM}', false)`);
const result = (await db.query(`SELECT discard_import_batch($1) AS r`, [batch])).rows[0].r;
check('data manager discard removes its properties', result.properties_removed === 2 && result.batches_removed === 1, JSON.stringify(result));
check('other import is untouched', (await count(`SELECT count(*)::int AS n FROM properties WHERE internal_id='K-1'`)) === 1);
check('batch record is gone', (await count(`SELECT count(*)::int AS n FROM import_batches WHERE id='${batch}'`)) === 0);
check('owners go with the property', (await count(`SELECT count(*)::int AS n FROM property_owners`)) === 0);
const missing = await db.query(`SELECT discard_import_batch($1) AS r`, [batch]).then(() => null, (e) => e.message);
check('discarding twice reports not found', !!missing && /not found/.test(missing), missing ?? '');

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
await db.close();
