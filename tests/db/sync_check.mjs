// SmarterContact MCP sync check (migration 020: smartercontact_mcp_sync). Run with: npm run test:db
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
  'CREATE ROLE service_role',
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

// An admin profile to record the campaign under.
const ACTOR = '00000000-0000-4000-8000-000000000001';
await run(`INSERT INTO auth.users (id) VALUES ($1)`, [ACTOR]);
await run(`INSERT INTO profiles (id, email, role) VALUES ($1, 'admin@example.test', 'admin')`, [ACTOR]);

// Properties: A has the phone on a phone link, B has it as an owner phone, C and D share one phone, E has none.
const prop = async (internal, apn, owner) =>
  (await run(
    `INSERT INTO properties (internal_id, source, state, county, apn_raw, owner_name, marketing_status, total_contacts)
     VALUES ($1,'land_portal','FL','Lafayette',$2,$3,'never_contacted',0) RETURNING id`,
    [internal, apn, owner],
  ))[0].id;
const a = await prop('SYNC-A', '31-06-14', 'Coen Dorothy');
const b = await prop('SYNC-B', '31-06-15', 'Cannon Mary');
const c = await prop('SYNC-C', '31-06-16', 'Shared One');
const d = await prop('SYNC-D', '31-06-17', 'Shared Two');
await prop('SYNC-E', '31-06-18', 'Nobody Phone');

const phoneId = async (number) => {
  await run(`INSERT INTO phone_numbers (phone_number) VALUES ($1) ON CONFLICT (phone_number) DO NOTHING`, [number]);
  return (await run(`SELECT id FROM phone_numbers WHERE phone_number = $1`, [number]))[0].id;
};
await run(`INSERT INTO property_phones (property_id, phone_number_id, position) VALUES ($1,$2,1)`, [a, await phoneId('8434758031')]);
await run(`INSERT INTO property_owners (property_id, first_name, last_name, owner_sequence, phone_numbers) VALUES ($1,'Mary','Cannon',1,ARRAY['+1 (352) 555-0199'])`, [b]);
await run(`INSERT INTO property_phones (property_id, phone_number_id, position) VALUES ($1,$2,1)`, [c, await phoneId('3525550123')]);
await run(`INSERT INTO property_phones (property_id, phone_number_id, position) VALUES ($1,$2,1)`, [d, await phoneId('3525550123')]);

const rows = [
  { phone: '8434758031', name: 'Dorothy Coen', last_campaign_at: '2026-11-24T10:28:00Z', replied: true, opted_out: false },
  { phone: '3525550199', name: 'Mary Cannon', last_campaign_at: '2026-11-20T09:00:00Z', replied: true, opted_out: true },
  { phone: '3525550123', name: 'Shared Phone', last_campaign_at: '2026-11-21T09:00:00Z', replied: false, opted_out: false },
  { phone: '2125550000', name: 'Unknown', last_campaign_at: '2026-11-21T09:00:00Z', replied: false, opted_out: false },
  { phone: '12', name: 'Bad Number', last_campaign_at: '2026-11-21T09:00:00Z', replied: false, opted_out: false },
];

const sync = async (apply) =>
  (await run(`SELECT smartercontact_mcp_sync($1::jsonb, $2, $3) AS r`, [JSON.stringify(rows), apply, ACTOR]))[0].r;

// Preview: counts and review only, nothing written.
const preview = await sync(false);
check('preview counts the matched rows', preview.rows_matched === 2 && preview.mode === 'preview', JSON.stringify(preview));
check('preview lists the review reasons', preview.review.length === 3, JSON.stringify(preview.review));
const reasons = preview.review.map((r) => r.reason).sort();
check(
  'review reasons are the expected three',
  JSON.stringify(reasons) === JSON.stringify(['No property has this phone number', 'Not a valid phone number', 'Phone is on more than one property']),
  JSON.stringify(reasons),
);
const beforeApply = await run(`SELECT count(*)::int AS n FROM campaign_contacts`);
check('preview writes nothing', beforeApply[0].n === 0);

// Apply.
const applied = await sync(true);
check('apply reports the writes', applied.mode === 'applied' && applied.contacts_linked === 2 && applied.opt_outs_recorded === 1, JSON.stringify(applied));

const statusA = (await run(`SELECT marketing_status, total_contacts, last_contacted_at FROM properties WHERE id = $1`, [a]))[0];
check('a reply moves the property to responded', statusA.marketing_status === 'responded', JSON.stringify(statusA));
check(
  'the contact count and last contacted date are set',
  statusA.total_contacts === 1 && new Date(statusA.last_contacted_at).toISOString().startsWith('2026-11-24'),
  JSON.stringify(statusA),
);

const statusB = (await run(`SELECT marketing_status FROM properties WHERE id = $1`, [b]))[0];
check('a stop reply marks the property opted out', statusB.marketing_status === 'opted_out', JSON.stringify(statusB));

const suppressions = await run(
  `SELECT count(*)::int AS n FROM phone_suppressions ps JOIN phone_numbers pn ON pn.id = ps.phone_number_id WHERE pn.phone_number = '3525550199' AND ps.suppression_type = 'opt_out'`,
);
check('the stop reply is recorded as an opt-out suppression', suppressions[0].n === 1);

const cPropStatus = (await run(`SELECT marketing_status FROM properties WHERE id = $1`, [c]))[0];
check('the shared phone changes no property', cPropStatus.marketing_status === 'never_contacted');

// Running the same rows again changes nothing.
const contactsBefore = (await run(`SELECT count(*)::int AS n FROM campaign_contacts`))[0].n;
const suppressionsBefore = (await run(`SELECT count(*)::int AS n FROM phone_suppressions`))[0].n;
await sync(true);
const contactsAfter = (await run(`SELECT count(*)::int AS n FROM campaign_contacts`))[0].n;
const suppressionsAfter = (await run(`SELECT count(*)::int AS n FROM phone_suppressions`))[0].n;
check('a second run adds no campaign contacts', contactsBefore === contactsAfter, `${contactsBefore} -> ${contactsAfter}`);
check('a second run adds no suppressions', suppressionsBefore === suppressionsAfter, `${suppressionsBefore} -> ${suppressionsAfter}`);

console.log(failures === 0 ? '\nSmarterContact sync: all checks passed' : `\nSmarterContact sync: ${failures} failed`);
if (failures > 0) process.exit(1);
