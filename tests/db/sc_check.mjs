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

const DM = '11111111-1111-1111-1111-111111111111';
const VIEWER = '22222222-2222-2222-2222-222222222222';
await db.exec(`INSERT INTO auth.users (id) VALUES ('${DM}'), ('${VIEWER}')`);
await db.exec(`INSERT INTO profiles (id, role, email) VALUES ('${DM}', 'data_manager', 'dm@test.local'), ('${VIEWER}', 'user', 'v@test.local')`);

// Properties: one Baldwin parcel with a "responded" status (must not be downgraded),
// one Baldwin parcel never contacted, and two properties sharing one APN in Rusk (ambiguous).
const pSmith = (await run(`INSERT INTO properties (internal_id, source, state, county, apn_raw, marketing_status, total_contacts)
  VALUES ('BAL-1','land_portal','AL','Baldwin','60-05-16-0-000-011.001','responded',0) RETURNING id`))[0].id;
const pNew = (await run(`INSERT INTO properties (internal_id, source, state, county, apn_raw, marketing_status)
  VALUES ('BAL-2','land_portal','AL','Baldwin','52-08-25-3-005-037.001','never_contacted') RETURNING id`))[0].id;
await run(`INSERT INTO properties (internal_id, source, state, county, apn_raw) VALUES ('RUSK-A','land_portal','TX','Rusk','135176931')`);
await run(`INSERT INTO properties (internal_id, source, state, county, apn_raw) VALUES ('RUSK-B','land_portal','TX','Rusk','0135176931')`);

const rows = [
  { apn: '60-05-16-0-000-011.001', state: 'AL', county: 'Baldwin', owner: 'Smith', phone: '+12515104816', date_added: '2026-07-29', campaigns: ['AL Baldwin 07/26 10YR', 'AL Baldwin REHIT 10YR 11-26'] },
  { apn: '52-08-25-3-005-037.001', state: 'AL', county: 'Baldwin', owner: 'Barbato', phone: '', date_added: '2026-07-12', campaigns: ['AL Baldwin 07/26 10YR'] },
  { apn: '99-99-99-9-999-999.999', state: 'AL', county: 'Baldwin', owner: 'Nobody', phone: '+12515550000', date_added: '2026-07-01', campaigns: ['AL Baldwin 07/26 10YR'] },
  { apn: '135176931', state: 'TX', county: 'Rusk', owner: 'Ambiguous', phone: '+19035550100', date_added: '2026-11-09', campaigns: ['TX Rusk NEW'] },
  { apn: '', state: 'AL', county: 'Baldwin', owner: 'No APN', phone: '', date_added: '2026-07-01', campaigns: [] },
];
const payload = JSON.stringify(rows);
const countOf = async (sql) => Number((await run(sql))[0].n);
const campaignsNow = () => countOf(`SELECT count(*)::int AS n FROM campaigns`);

// Permission and sign-in checks come first.
await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`);
const anon = await db.query(`SELECT smartercontact_import('f', $1::jsonb, false) AS r`, [payload]).then(() => null, (e) => e.message);
check('signed-out preview is refused', !!anon && /Sign in/.test(anon), anon ?? '');

await db.exec(`SELECT set_config('request.jwt.claim.sub', '${VIEWER}', false)`);
const viewerApply = await db.query(`SELECT smartercontact_import('f', $1::jsonb, true) AS r`, [payload]).then(() => null, (e) => e.message);
check('plain user cannot apply', !!viewerApply && /cannot import/.test(viewerApply), viewerApply ?? '');
const viewerPreview = await db.query(`SELECT smartercontact_import('f', $1::jsonb, false) AS r`, [payload]).then((r) => r.rows[0].r, (e) => e.message);
check('plain user can preview', typeof viewerPreview === 'object' && viewerPreview.rows_matched === 2, JSON.stringify(viewerPreview?.rows_matched));

// Preview writes nothing.
await db.exec(`SELECT set_config('request.jwt.claim.sub', '${DM}', false)`);
const preview = (await db.query(`SELECT smartercontact_import('sc.csv', $1::jsonb, false) AS r`, [payload])).rows[0].r;
check('preview counts matches and review rows', preview.rows_total === 5 && preview.rows_matched === 2 && preview.rows_review === 3, JSON.stringify({ t: preview.rows_total, m: preview.rows_matched, r: preview.rows_review }));
check('preview lists the reasons', preview.review.some((x) => /No property/.test(x.reason)) && preview.review.some((x) => /more than one/.test(x.reason)) && preview.review.some((x) => /Missing APN/.test(x.reason)));
check('preview writes nothing', (await campaignsNow()) === 0 && (await countOf(`SELECT count(*)::int AS n FROM campaign_contacts`)) === 0 && (await countOf(`SELECT count(*)::int AS n FROM smartercontact_import_runs`)) === 0);

// Apply.
const applied = (await db.query(`SELECT smartercontact_import('sc.csv', $1::jsonb, true) AS r`, [payload])).rows[0].r;
check('apply links both matched contacts', applied.rows_matched === 2 && applied.contacts_linked === 3, JSON.stringify({ contacts: applied.contacts_linked }));
check('apply links phones', applied.phones_linked === 1, JSON.stringify({ phones: applied.phones_linked }));
check('apply records the run', (await countOf(`SELECT count(*)::int AS n FROM smartercontact_import_runs`)) === 1 && !!applied.run_id);
check('campaigns created once each', (await campaignsNow()) === 2, `campaigns=${await campaignsNow()}`);

const smith = (await run(`SELECT marketing_status, total_contacts, last_contacted_at FROM properties WHERE id=$1`, [pSmith]))[0];
check('responded status is not downgraded', smith.marketing_status === 'responded', smith.marketing_status);
check('contact count is the number of campaigns', Number(smith.total_contacts) === 2, `total=${smith.total_contacts}`);
check('last contacted date set', (smith.last_contacted_at instanceof Date ? smith.last_contacted_at.toISOString() : String(smith.last_contacted_at)).startsWith('2026-07-29'), String(smith.last_contacted_at));

const nw = (await run(`SELECT marketing_status, total_contacts FROM properties WHERE id=$1`, [pNew]))[0];
check('never contacted becomes contacted', nw.marketing_status === 'contacted' && Number(nw.total_contacts) === 1, JSON.stringify(nw));

const link = await countOf(`SELECT count(*)::int AS n FROM property_phones WHERE property_id='${pSmith}'`);
check('phone is on the matched property', link === 1);

// Re-running the same file changes nothing.
const before = { cc: await countOf(`SELECT count(*)::int AS n FROM campaign_contacts`), ph: await countOf(`SELECT count(*)::int AS n FROM property_phones`), cp: await campaignsNow() };
const again = (await db.query(`SELECT smartercontact_import('sc.csv', $1::jsonb, true) AS r`, [payload])).rows[0].r;
const after = { cc: await countOf(`SELECT count(*)::int AS n FROM campaign_contacts`), ph: await countOf(`SELECT count(*)::int AS n FROM property_phones`), cp: await campaignsNow() };
check('rerun adds no duplicate contacts, phones or campaigns', JSON.stringify(before) === JSON.stringify(after) && again.contacts_linked === 0 && again.phones_linked === 0, JSON.stringify({ before, after }));
check('rerun does not change the contact count', Number((await run(`SELECT total_contacts FROM properties WHERE id=$1`, [pSmith]))[0].total_contacts) === 2);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
await db.close();
