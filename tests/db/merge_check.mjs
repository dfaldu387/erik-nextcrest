import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIG = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const db = await PGlite.create({ extensions: { uuid_ossp } });
const run = async (sql, params) => (await db.query(sql, params)).rows;
const ignore = (p) => p.catch(() => {});

const stubs = [
  'CREATE SCHEMA IF NOT EXISTS auth',
  'CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)',
  "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$",
  "CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$",
  'CREATE ROLE authenticated',
  'CREATE ROLE anon',
];
await ignore(db.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'));
for (const s of stubs) await ignore(db.exec(s));

for (const f of fs.readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) {
  if (f.startsWith('003_')) continue; // demo seed data needs real auth users
  const sql = fs
    .readFileSync(`${MIG}/${f}`, 'utf8')
    .replace(/CREATE EXTENSION[^;]*pg_trgm[^;]*;/g, '')
    .replace(/gin_trgm_ops/g, '');
  try {
    await db.exec(sql);
  } catch (e) {
    await ignore(db.exec('ROLLBACK'));
    console.log('migration failed:', f, String(e.message).slice(0, 120));
  }
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};

const DM = '11111111-1111-1111-1111-111111111111';
const VIEWER = '22222222-2222-2222-2222-222222222222';
await db.exec(`INSERT INTO auth.users (id) VALUES ('${DM}'), ('${VIEWER}')`);
await db.exec(`INSERT INTO profiles (id, role, email) VALUES ('${DM}', 'data_manager', 'dm@test.local'), ('${VIEWER}', 'user', 'viewer@test.local')`);

// Keep: sparse record. Remove: fuller duplicate with an owner, identifier, phone and dataset row.
const keep = (await run(
  `INSERT INTO properties (internal_id, source, state, county, owner_name, first_acquired_at)
   VALUES ('KEEP-1','land_portal','FL','Lafayette','Smith John','2026-01-10') RETURNING id`,
))[0].id;
const remove = (await run(
  `INSERT INTO properties (internal_id, source, state, county, city, owner_name, acreage, apn_raw, first_acquired_at, last_contacted_at)
   VALUES ('REMOVE-1','land_portal','FL','Lafayette','Mayo','Smith John',9.5,'31-06-14','2026-02-01','2026-03-01') RETURNING id`,
))[0].id;
await run(`INSERT INTO property_owners (property_id, first_name, last_name, owner_sequence) VALUES ($1,'John','Smith',1)`, [keep]);
await run(`INSERT INTO property_owners (property_id, first_name, last_name, owner_sequence) VALUES ($1,'John','Smith',1)`, [remove]);
await run(`INSERT INTO property_owners (property_id, company_name, owner_sequence) VALUES ($1,'Acme Land LLC',2)`, [remove]);
await run(
  `INSERT INTO property_identifiers (property_id, identifier_type, identifier_value, normalized_value) VALUES ($1,'alt_apn','31-06-14','313614')`,
  [remove],
);
const phone = (await run(`INSERT INTO phone_numbers (phone_number) VALUES ('8134151310') RETURNING id`))[0].id;
await run(`INSERT INTO property_phones (property_id, phone_number_id, position) VALUES ($1,$2,1)`, [remove, phone]);
await run(`INSERT INTO dataset_records (property_id, raw_data) VALUES ($1, '{"apn":"31-06-14"}')`, [remove]);
const countProps = async () => Number((await run(`SELECT count(*)::int AS n FROM properties`))[0].n);
const beforeTotal = await countProps();

async function callMerge(user, keepId, removeId, notes = 'test') {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${user ?? ''}', false)`);
  try {
    const r = await db.query(`SELECT merge_properties($1, $2, $3) AS result`, [removeId, keepId, notes]);
    return { ok: true, result: r.rows[0].result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const denied = await callMerge(VIEWER, keep, remove);
check('plain user is refused', !denied.ok && /cannot merge/.test(denied.error), denied.error ?? '');

const anon = await callMerge(null, keep, remove);
check('signed-out caller is refused', !anon.ok && /Sign in/.test(anon.error), anon.error ?? '');

const same = await callMerge(DM, keep, keep);
check('same property twice is refused', !same.ok, same.error ?? '');

const stillThere = Number((await run(`SELECT count(*)::int AS n FROM properties WHERE id = $1`, [remove]))[0].n);
check('refused merges change nothing', stillThere === 1 && (await countProps()) === beforeTotal);

const ok = await callMerge(DM, keep, remove, 'Same parcel, typed twice');
check('data manager merge succeeds', ok.ok, ok.error ?? '');
if (ok.ok) {
  const r = ok.result;
  check('only the new owner moved (duplicate owner skipped)', r.owners_moved === 1, JSON.stringify(r));
  check('identifier moved', r.identifiers_moved === 1);
  check('phone link moved', r.phones_moved === 1);
  check('dataset record moved', r.dataset_records_moved === 1);
}

const k = (await run(`SELECT * FROM properties WHERE id = $1`, [keep]))[0];
check('removed property is gone', Number((await run(`SELECT count(*)::int AS n FROM properties WHERE id=$1`, [remove]))[0].n) === 0);
check(
  'blank fields filled from duplicate',
  k.city === 'Mayo' && Number(k.acreage) === 9.5 && k.apn_raw === '31-06-14',
  `city=${k.city} acres=${k.acreage} apn=${k.apn_raw}`,
);
check('existing values kept', k.owner_name === 'Smith John' && k.county === 'Lafayette' && k.internal_id === 'KEEP-1');
const iso = (v) => (v instanceof Date ? v.toISOString() : String(v));
check('earliest acquisition date kept', iso(k.first_acquired_at).startsWith('2026-01-10'), iso(k.first_acquired_at));
check('latest contact date kept', iso(k.last_contacted_at).startsWith('2026-03-01'), iso(k.last_contacted_at));

const owners = await run(`SELECT company_name, last_name FROM property_owners WHERE property_id=$1 ORDER BY owner_sequence`, [keep]);
check('kept property has both owners', owners.length === 2, JSON.stringify(owners));
const phones = Number((await run(`SELECT count(*)::int AS n FROM property_phones WHERE property_id=$1`, [keep]))[0].n);
check('kept property has the phone', phones === 1);
const hist = (await run(`SELECT source_property_id, target_property_id, merged_by, notes, preserved_data FROM property_merge_history`))[0];
check(
  'merge history row written',
  !!hist && hist.source_property_id === remove && hist.target_property_id === keep && hist.merged_by === DM && hist.notes === 'Same parcel, typed twice',
);
check(
  'history keeps the removed record in full',
  !!hist &&
    hist.preserved_data.property.internal_id === 'REMOVE-1' &&
    hist.preserved_data.owners.length === 2 &&
    hist.preserved_data.identifiers.length === 1 &&
    hist.preserved_data.phones.length === 1,
);

// Failure case: a campaign-contact clash must roll the whole merge back.
const keep2 = (await run(`INSERT INTO properties (internal_id, source, state, county) VALUES ('KEEP-2','land_portal','FL','Hardee') RETURNING id`))[0].id;
const remove2 = (await run(`INSERT INTO properties (internal_id, source, state, county, owner_name) VALUES ('REMOVE-2','land_portal','FL','Hardee','Jones Ann') RETURNING id`))[0].id;
await run(`INSERT INTO property_owners (property_id, first_name, last_name, owner_sequence) VALUES ($1,'Ann','Jones',1)`, [remove2]);
const cid = (await run(`INSERT INTO campaigns (name, created_by) VALUES ('c', $1) RETURNING id`, [DM]))[0].id;
await run(
  `INSERT INTO campaign_contacts (campaign_id, property_id, phone_number) VALUES ($1,$2,'8130000000'), ($1,$3,'8130000000')`,
  [cid, remove2, keep2],
);
// The skipped campaign contact (clash with the kept property) is saved in the merge history.
const clashOk = await callMerge(DM, keep2, remove2, 'clash test');
check('merge with a campaign clash succeeds', clashOk.ok, clashOk.ok ? '' : clashOk.error.slice(0, 120));
if (clashOk.ok) {
  const h2 = (await run(`SELECT preserved_data FROM property_merge_history WHERE source_property_id = $1`, [remove2]))[0];
  check(
    'skipped campaign contact is kept in history',
    !!h2 && h2.preserved_data.campaign_contacts.length === 1,
    h2 ? `rows=${h2.preserved_data.campaign_contacts.length}` : 'no history row',
  );
}

// Atomicity: force a failure at the last step and confirm every earlier change is undone.
const keep3 = (await run(`INSERT INTO properties (internal_id, source, state, county) VALUES ('KEEP-3','land_portal','FL','Rusk') RETURNING id`))[0].id;
const remove3 = (await run(`INSERT INTO properties (internal_id, source, state, county, city) VALUES ('REMOVE-3','land_portal','FL','Rusk','Tyler') RETURNING id`))[0].id;
await run(`INSERT INTO property_owners (property_id, first_name, last_name, owner_sequence) VALUES ($1,'Ann','Jones',1)`, [remove3]);
await run(`INSERT INTO dataset_records (property_id, raw_data) VALUES ($1, '{"x":1}')`, [remove3]);
await db.exec(`
  CREATE OR REPLACE FUNCTION test_block_delete() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'forced failure for rollback test'; END $$;
  CREATE TRIGGER test_block_delete BEFORE DELETE ON properties FOR EACH ROW EXECUTE FUNCTION test_block_delete();
`);
const failed = await callMerge(DM, keep3, remove3);
await db.exec('DROP TRIGGER IF EXISTS test_block_delete ON properties');
const removeStill = Number((await run(`SELECT count(*)::int AS n FROM properties WHERE id=$1`, [remove3]))[0].n);
const ownersOnRemove = Number((await run(`SELECT count(*)::int AS n FROM property_owners WHERE property_id=$1`, [remove3]))[0].n);
const recordsOnRemove = Number((await run(`SELECT count(*)::int AS n FROM dataset_records WHERE property_id=$1`, [remove3]))[0].n);
const keepCity = (await run(`SELECT city FROM properties WHERE id=$1`, [keep3]))[0].city;
const histRows = Number((await run(`SELECT count(*)::int AS n FROM property_merge_history WHERE source_property_id=$1`, [remove3]))[0].n);
check(
  'failed merge is fully rolled back',
  !failed.ok && removeStill === 1 && ownersOnRemove === 1 && recordsOnRemove === 1 && keepCity === null && histRows === 0,
  failed.ok ? 'merge unexpectedly succeeded' : failed.error.slice(0, 120),
);

const failCount = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failCount} passed, ${failCount} failed`);
await db.close();
