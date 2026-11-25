// ZIP filter check for search_properties (migration 018). Run with: npm run test:db
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

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${ok ? '' : extra}`);
  if (!ok) failures += 1;
};

await run(
  `INSERT INTO properties (internal_id, source, state, county, zip_code, owner_name) VALUES
   ('ZIP-A','land_portal','FL','Lafayette','32066','Smith John'),
   ('ZIP-B','land_portal','FL','Lafayette','32068-0001','Jones Ann'),
   ('ZIP-C','land_portal','FL','Lafayette','32070','Doe Jane'),
   ('ZIP-D','land_portal','FL','Hardee','32066','Ray Tom'),
   ('ZIP-E','land_portal','FL','Lafayette',NULL,'Blank Zip')`,
);

const apns = async (zips, extra = '') => {
  const rows = await run(
    `SELECT apn FROM search_properties(p_zips => $1::text[], p_limit => 100 ${extra})`,
    [zips],
  );
  return rows.map((r) => r.apn).sort();
};

const all = await apns(null);
check('no ZIP filter returns every property', all.length === 5, JSON.stringify(all));
check('empty ZIP list returns every property', (await apns([])).length === 5);
check('one ZIP matches only that ZIP', JSON.stringify(await apns(['32066'])) === JSON.stringify(['ZIP-A', 'ZIP-D']), JSON.stringify(await apns(['32066'])));
check('ZIP+4 stored value matches its 5-digit ZIP', JSON.stringify(await apns(['32068'])) === JSON.stringify(['ZIP-B']));
check('several ZIPs match any of them', JSON.stringify(await apns(['32066', '32070'])) === JSON.stringify(['ZIP-A', 'ZIP-C', 'ZIP-D']));
check('unknown ZIP returns nothing', (await apns(['99999'])).length === 0);
check('blank stored ZIP is not matched', !(await apns(['32066', '32068', '32070'])).includes('ZIP-E'));

const countRow = await run(
  `SELECT apn, total_count FROM search_properties(p_zips => $1::text[], p_county => 'Lafayette', p_limit => 100)`,
  [['32066']],
);
check('ZIP combines with county and reports the total', countRow.length === 1 && Number(countRow[0].total_count) === 1, JSON.stringify(countRow));

const paged = await run(
  `SELECT apn, total_count FROM search_properties(p_zips => $1::text[], p_limit => 1, p_offset => 1)`,
  [['32066']],
);
check('paging keeps the ZIP filter and total', paged.length === 1 && Number(paged[0].total_count) === 2, JSON.stringify(paged));

const [options] = await run('SELECT property_filter_options() AS o');
const zipOptions = (options.o.zips ?? []).map((z) => `${z.state}|${z.county}|${z.zip}`).sort();
check(
  'filter options list each ZIP once per county, first five digits only',
  JSON.stringify(zipOptions) === JSON.stringify(['FL|Hardee|32066', 'FL|Lafayette|32066', 'FL|Lafayette|32068', 'FL|Lafayette|32070']),
  JSON.stringify(zipOptions),
);

console.log(failures === 0 ? `\nZIP filter: all checks passed` : `\nZIP filter: ${failures} failed`);
if (failures > 0) process.exit(1);
