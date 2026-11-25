// SmarterContact history sync. Reads campaign history through the SmarterContact MCP connector and loads it
// into NextCrest (migration 020). Runs on your machine, not in the browser.
//
//   npm run sync:smartercontact                  fetch from SmarterContact, save locally, preview the load (nothing written)
//   npm run sync:smartercontact -- --apply       fetch, then write the matched rows to the database
//   npm run sync:smartercontact -- --from-cache --apply   write again from the saved fetch, without reading SmarterContact
//   npm run sync:smartercontact -- --limit=50    fetch only the first 50 conversations (a test run)
//
// Environment (from .env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
// Optional: SC_SYNC_ACTOR_ID (the profile id to record campaigns under; defaults to the first admin),
//           SC_SYNC_OUT (folder for the saved fetch and review list; defaults to ~/.nextcrest/sync).
//
// Access is read-only: the sign-in asks for contacts:read and conversations:read, and the code never sends a
// message or changes a contact. read_conversation is always called without markRead, so nothing is marked read.
// The sign-in tokens are kept in ~/.nextcrest/smartercontact-mcp.json, outside the repository.

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationFull, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  INBOX_FOLDERS,
  mergeInboxFolders,
  toInboxDetails,
  toMessageRow,
  toSyncRow,
  type ContactSummary,
  type ConversationItem,
  type InboxFolder,
  type ListedConversation,
  type MessageRow,
  type SyncRow,
  type ThreadItem,
} from './transform.ts';

const MCP_URL = 'https://api.smartercontact.com/rest/mcp';
const READ_SCOPES = 'contacts:read conversations:read';
const CALLBACK_PORT = 47153; // separate from the port Claude Code uses, so the two sign-ins never clash
const REDIRECT_URL = `http://localhost:${CALLBACK_PORT}/callback`;
const PACE_MS = 150; // pause between SmarterContact calls
const LOAD_BATCH = 500; // contacts per database call

const STATE_DIR = join(homedir(), '.nextcrest');
const TOKEN_FILE = join(STATE_DIR, 'smartercontact-mcp.json');
const OUT_DIR = process.env.SC_SYNC_OUT ?? join(STATE_DIR, 'sync');

// ---------- sign-in ----------

interface StoredAuth {
  client?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
  verifier?: string;
  state?: string;
}

// Keeps the sign-in in a file so the sync can run again without asking you to approve every time.
class FileAuthProvider implements OAuthClientProvider {
  private readonly path: string;
  private store: StoredAuth;

  constructor(path: string) {
    this.path = path;
    this.store = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as StoredAuth) : {};
  }

  private save(): void {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.store, null, 2), { mode: 0o600 });
  }

  get redirectUrl(): string {
    return REDIRECT_URL;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'NextCrest SmarterContact sync',
      redirect_uris: [REDIRECT_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: READ_SCOPES,
    };
  }

  state(): string {
    if (!this.store.state) {
      this.store.state = randomBytes(16).toString('hex');
      this.save();
    }
    return this.store.state;
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    return this.store.client;
  }

  saveClientInformation(info: OAuthClientInformationFull): void {
    this.store.client = info;
    this.save();
  }

  tokens(): OAuthTokens | undefined {
    return this.store.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.store.tokens = tokens;
    this.save();
    if (tokens.scope) console.log(`Granted scopes: ${tokens.scope}`);
  }

  // Called by the SDK when approval is needed. The link is shown here; waitForApproval() receives the reply.
  // The SDK asks for every scope the server lists, which includes write access. This sync only needs reads,
  // so the request is narrowed to those scopes before the link is shown.
  redirectToAuthorization(url: URL): void {
    url.searchParams.set('scope', READ_SCOPES);
    console.log('\nApprove the SmarterContact connection in your browser (read access only):\n');
    console.log(url.toString());
    console.log(`\nWaiting for approval on ${REDIRECT_URL} ...\n`);
  }

  saveCodeVerifier(verifier: string): void {
    this.store.verifier = verifier;
    this.save();
  }

  codeVerifier(): string {
    return this.store.verifier ?? '';
  }
}

// Listens on the callback address for the approval redirect and returns the authorization code.
function waitForApproval(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URL);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const ok = !!code && url.searchParams.get('state') === expectedState;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ok ? '<p>Connected. You can close this tab and return to the terminal.</p>' : '<p>Sign-in failed. Return to the terminal.</p>');
      clearTimeout(timer);
      server.close();
      if (ok && code) resolve(code);
      else reject(new Error('The approval response did not match this sync run. Run the sync again.'));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for approval (5 minutes). Run the sync again.'));
    }, 5 * 60_000);
    server.listen(CALLBACK_PORT);
  });
}

async function connect(): Promise<Client> {
  const provider = new FileAuthProvider(TOKEN_FILE);
  const newClient = () => new Client({ name: 'nextcrest-smartercontact-sync', version: '1.0.0' }, { capabilities: {} });
  const newTransport = () => new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: provider });

  const client = newClient();
  const transport = newTransport();
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
  }

  const code = await waitForApproval(provider.state());
  await transport.finishAuth(code);
  const retry = newClient();
  await retry.connect(newTransport());
  console.log('Connected to SmarterContact.');
  return retry;
}

// ---------- reading SmarterContact ----------

// Calls one tool, retrying on transient failures, and returns its JSON reply.
async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as { type: string; text?: string }[]).find((c) => c.type === 'text')?.text ?? '{}';
      if (result.isError) throw new Error(`${name} failed: ${text.slice(0, 200)}`);
      await pause(PACE_MS);
      return JSON.parse(text) as T;
    } catch (error) {
      if (attempt >= 4) throw error;
      await pause(1000 * attempt * attempt);
    }
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Pages through a folder. Stops when there is no next token, when a page is empty, or when the token repeats,
// so a server that keeps returning the same token cannot make the sync loop forever.
async function listAll(client: Client, category: string, limit: number | null): Promise<ListedConversation[]> {
  const items: ListedConversation[] = [];
  const seen = new Set<string>();
  let token: string | undefined;
  do {
    if (token) {
      if (seen.has(token)) throw new Error(`The ${category} list repeated a page token. Stopped to avoid looping.`);
      seen.add(token);
    }
    const page = await call<{ items: ListedConversation[]; nextPageToken?: string }>(client, 'list_conversations', {
      category,
      limit: 100,
      ...(token ? { nextPageToken: token } : {}),
    });
    if (page.items.length === 0) break;
    items.push(...page.items);
    console.log(`  ${category}: ${items.length} so far`);
    token = page.nextPageToken;
    if (limit && items.length >= limit) break;
  } while (token);
  return limit ? items.slice(0, limit) : items;
}

async function listConversations(client: Client, limit: number | null): Promise<ContactSummary[]> {
  const items = await listAll(client, 'all', limit);
  return items.map((item) => ({ contactId: item.contactId, name: item.name ?? '', phone: item.phone ?? '' }));
}

async function readHistory(client: Client, contactId: string): Promise<ConversationItem[]> {
  const items: ConversationItem[] = [];
  let token: string | undefined;
  do {
    const page = await call<{ items: ConversationItem[]; nextPageToken?: string }>(client, 'read_conversation', {
      contactId,
      limit: 100,
      ...(token ? { nextPageToken: token } : {}),
    });
    items.push(...page.items);
    token = page.nextPageToken;
  } while (token);
  return items;
}

async function fetchRows(client: Client, limit: number | null): Promise<{ scanned: number; rows: SyncRow[] }> {
  const contacts = await listConversations(client, limit);
  console.log(`Found ${contacts.length} conversations. Reading campaign history...`);
  const rows: SyncRow[] = [];
  for (const [index, contact] of contacts.entries()) {
    const row = toSyncRow(contact, await readHistory(client, contact.contactId));
    if (row) rows.push(row);
    if ((index + 1) % 100 === 0) console.log(`  ${index + 1} of ${contacts.length} read, ${rows.length} campaign contacts so far`);
  }
  return { scanned: contacts.length, rows };
}

// ---------- loading NextCrest ----------

interface Review {
  phone: string;
  name: string;
  reason: string;
}

interface LoadSummary {
  mode: 'preview' | 'applied';
  rows_total: number;
  rows_matched: number;
  rows_review: number;
  phones_linked: number;
  contacts_linked: number;
  opt_outs_recorded: number;
  review: Review[];
}

async function loadRows(db: SupabaseClient, rows: SyncRow[], apply: boolean, actor: string | null): Promise<LoadSummary> {
  const total: LoadSummary = {
    mode: apply ? 'applied' : 'preview',
    rows_total: 0,
    rows_matched: 0,
    rows_review: 0,
    phones_linked: 0,
    contacts_linked: 0,
    opt_outs_recorded: 0,
    review: [],
  };
  for (let start = 0; start < rows.length; start += LOAD_BATCH) {
    const batch = rows.slice(start, start + LOAD_BATCH);
    const { data, error } = await db.rpc('smartercontact_mcp_sync', { p_rows: batch, p_apply: apply, p_actor: actor });
    if (error) throw new Error(`Database load failed: ${error.message}`);
    const part = data as LoadSummary;
    total.rows_total += part.rows_total;
    total.rows_matched += part.rows_matched;
    total.rows_review += part.rows_review;
    total.phones_linked += part.phones_linked;
    total.contacts_linked += part.contacts_linked;
    total.opt_outs_recorded += part.opt_outs_recorded;
    total.review.push(...part.review);
  }
  return total;
}

function writeReview(path: string, review: Review[]): void {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = ['phone,name,reason', ...review.map((r) => [r.phone, r.name, r.reason].map(escape).join(','))];
  writeFileSync(path, lines.join('\n') + '\n');
}

// ---------- Inbox (the Messenger folders) ----------

// Reads every Messenger folder and replaces smartercontact_conversations with the result (migration 021).
// Conversations that are no longer in any folder are removed. Only the conversation lists are read,
// not the message history, so this is one short call per 100 conversations per folder.
async function syncInbox(client: Client, db: SupabaseClient): Promise<void> {
  const started = new Date().toISOString();
  const lists: Partial<Record<InboxFolder, ListedConversation[]>> = {};
  for (const folder of INBOX_FOLDERS) {
    lists[folder] = await listAll(client, folder, null);
    console.log(`  ${folder}: ${lists[folder]?.length ?? 0}`);
  }

  const rows = mergeInboxFolders(lists);

  // A phone links to a property only when it is on exactly one property (the same rule as migration 020).
  const phones = [...new Set(rows.map((r) => r.phone).filter((p): p is string => !!p))];
  const propertyByPhone = new Map<string, string>();
  for (let start = 0; start < phones.length; start += LOAD_BATCH) {
    const { data, error } = await db
      .from('phone_numbers')
      .select('phone_number, property_phones(property_id)')
      .in('phone_number', phones.slice(start, start + LOAD_BATCH));
    if (error) throw new Error(`Phone lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      const links = (row.property_phones ?? []) as { property_id: string }[];
      if (links.length === 1) propertyByPhone.set(row.phone_number as string, links[0].property_id);
    }
  }

  const now = new Date().toISOString();
  for (let start = 0; start < rows.length; start += LOAD_BATCH) {
    const batch = rows.slice(start, start + LOAD_BATCH).map((r) => ({
      ...r,
      property_id: r.phone ? (propertyByPhone.get(r.phone) ?? null) : null,
      updated_at: now,
    }));
    const { error } = await db.from('smartercontact_conversations').upsert(batch, { onConflict: 'contact_id' });
    if (error) throw new Error(`Inbox save failed: ${error.message}`);
  }

  const { error: removeError } = await db.from('smartercontact_conversations').delete().lt('updated_at', started);
  if (removeError) throw new Error(`Inbox clean-up failed: ${removeError.message}`);

  console.log(`\nInbox saved: ${rows.length} conversations, ${propertyByPhone.size} linked to a property.`);

  // Properties with an inbox conversation are no longer "never marketed" (migration 024).
  const { data: changed, error: markError } = await db.rpc('smartercontact_inbox_mark_properties');
  if (markError) throw new Error(`Property status update failed: ${markError.message}`);
  console.log(`Property status aligned with the inbox: ${changed ?? 0} properties updated.`);
}

// Fills the Inbox columns (latest message, its time and direction, labels) for the most recent conversations.
// The "All" folder is newest first, so the first N are the ones shown at the top of the list. Each conversation
// costs two SmarterContact calls (its newest message and its contact), so N is kept modest by default.
async function syncInboxDetails(client: Client, db: SupabaseClient, count: number): Promise<void> {
  const labelNames = new Map<string, string>();
  let token: string | undefined;
  do {
    const page = await call<{ items: { id: string; name: string }[]; nextPageToken?: string }>(client, 'list_labels', {
      limit: 50,
      ...(token ? { nextPageToken: token } : {}),
    });
    for (const label of page.items) labelNames.set(label.id, label.name);
    token = page.nextPageToken;
  } while (token);
  console.log(`Labels in the account: ${labelNames.size}`);

  const recent = await listAll(client, 'all', count);
  console.log(`Filling details for the ${recent.length} most recent conversations...`);
  let done = 0;
  let failed = 0;
  for (const item of recent) {
    try {
      const history = await call<{ items: ConversationItem[] }>(client, 'read_conversation', { contactId: item.contactId, limit: 1 });
      const contact = await call<{ labelIds?: string[] }>(client, 'read_contact', { contactId: item.contactId });
      const details = toInboxDetails(history.items[0], contact.labelIds ?? [], labelNames);
      const { error } = await db
        .from('smartercontact_conversations')
        .update({ ...details, details_synced_at: new Date().toISOString() })
        .eq('contact_id', item.contactId);
      if (error) throw new Error(error.message);
      done += 1;
    } catch (error) {
      failed += 1;
      if (failed > 20) throw new Error(`Stopped after ${failed} failures. Last error: ${error instanceof Error ? error.message : error}`);
    }
    if (done > 0 && done % 50 === 0) console.log(`  ${done} of ${recent.length} done`);
  }
  console.log(`\nInbox details saved for ${done} conversations${failed ? `, ${failed} could not be read` : ''}.`);
}

// Fills the labels of every conversation in the Inbox (one contact read per conversation). Used for the
// follow-up label tabs. Only the labels column is written, so it can run on top of an existing inbox.
// Labels are read in chunks of `count` conversations per run. The next chunk is the conversations never labelled,
// then the ones labelled longest ago (and at least LABEL_REFRESH_DAYS ago). Each contact is read once per run.
const LABEL_REFRESH_DAYS = 14;

async function syncInboxLabels(client: Client, db: SupabaseClient, count: number): Promise<void> {
  const labelNames = new Map<string, string>();
  let token: string | undefined;
  do {
    const page = await call<{ items: { id: string; name: string }[]; nextPageToken?: string }>(client, 'list_labels', {
      limit: 50,
      ...(token ? { nextPageToken: token } : {}),
    });
    for (const label of page.items) labelNames.set(label.id, label.name);
    token = page.nextPageToken;
  } while (token);

  // The database returns at most 1,000 rows per query. Each batch is labelled and stamped before the next query,
  // so the next query returns the conversations that are still due, not the same ones again.
  const cutoff = new Date(Date.now() - LABEL_REFRESH_DAYS * 86_400_000).toISOString();
  console.log(`Reading labels for up to ${count} conversations (one contact read each)...`);
  let done = 0;
  let failed = 0;
  while (done + failed < count) {
    const { data: due, error: dueError } = await db
      .from('smartercontact_conversations')
      .select('contact_id')
      .or(`labels_synced_at.is.null,labels_synced_at.lt.${cutoff}`)
      .order('labels_synced_at', { ascending: true, nullsFirst: true })
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(Math.min(1000, count - done - failed));
    if (dueError) throw new Error(`Could not pick the next labels chunk: ${dueError.message}`);
    if (!due || due.length === 0) break;

    for (const row of due) {
      const contactId = row.contact_id as string;
      try {
        const contact = await call<{ labelIds?: string[] }>(client, 'read_contact', { contactId });
        const labels = (contact.labelIds ?? []).map((id) => labelNames.get(id)).filter((n): n is string => !!n);
        const { error } = await db
          .from('smartercontact_conversations')
          .update({ labels, labels_synced_at: new Date().toISOString() })
          .eq('contact_id', contactId);
        if (error) throw new Error(error.message);
        done += 1;
      } catch (error) {
        failed += 1;
        if (failed > 50) throw new Error(`Stopped after ${failed} failures. Last error: ${error instanceof Error ? error.message : error}`);
      }
      if (done > 0 && done % 500 === 0) console.log(`  ${done} done`);
    }
  }
  console.log(`\nLabels saved for ${done} conversations${failed ? `, ${failed} could not be read` : ''}.`);
}

// Stores the newest messages (up to 100 per conversation) for the most recent N conversations, so the Inbox
// thread can show them (migration 026). One SmarterContact call per conversation.
async function syncInboxMessages(client: Client, db: SupabaseClient, count: number): Promise<void> {
  const recent = await listAll(client, 'all', count);
  console.log(`Reading messages for the ${recent.length} most recent conversations...`);
  let stored = 0;
  let failed = 0;
  for (const [index, item] of recent.entries()) {
    try {
      const history = await call<{ items: ThreadItem[] }>(client, 'read_conversation', { contactId: item.contactId, limit: 100 });
      const rows = history.items.map((message) => toMessageRow(item.contactId, message)).filter((r): r is MessageRow => r !== null);
      if (rows.length > 0) {
        const { error } = await db.from('smartercontact_messages').upsert(rows, { onConflict: 'message_id' });
        if (error) throw new Error(error.message);
        stored += rows.length;
      }
    } catch (error) {
      failed += 1;
      if (failed > 20) throw new Error(`Stopped after ${failed} failures. Last error: ${error instanceof Error ? error.message : error}`);
    }
    if ((index + 1) % 50 === 0) console.log(`  ${index + 1} of ${recent.length} conversations read, ${stored} messages saved`);
  }
  console.log(`\nMessages saved: ${stored}${failed ? `, ${failed} conversations could not be read` : ''}.`);
}

// ---------- entry point ----------

function parseArgs(argv: string[]) {
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const detailsArg = argv.find((a) => a.startsWith('--inbox-details'));
  const messagesArg = argv.find((a) => a.startsWith('--inbox-messages'));
  return {
    inboxLabels: argv.find((a) => a.startsWith('--inbox-labels')) ? Number(argv.find((a) => a.startsWith('--inbox-labels'))!.split('=')[1] ?? 2000) || 2000 : null,
    apply: argv.includes('--apply'),
    fromCache: argv.includes('--from-cache'),
    inbox: argv.includes('--inbox'),
    inboxDetails: detailsArg ? Number(detailsArg.split('=')[1] ?? 500) || 500 : null,
    inboxMessages: messagesArg ? Number(messagesArg.split('=')[1] ?? 200) || 200 : null,
    limit: limitArg ? Number(limitArg.split('=')[1]) : null,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in .env.');

  mkdirSync(OUT_DIR, { recursive: true });

  if (args.inbox || args.inboxDetails !== null || args.inboxMessages !== null || args.inboxLabels !== null) {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const client = await connect();
    try {
      if (args.inbox) await syncInbox(client, db);
      if (args.inboxLabels !== null) await syncInboxLabels(client, db, args.inboxLabels);
      if (args.inboxDetails !== null) await syncInboxDetails(client, db, args.inboxDetails);
      if (args.inboxMessages !== null) await syncInboxMessages(client, db, args.inboxMessages);
    } finally {
      await client.close();
    }
    return;
  }

  const cachePath = join(OUT_DIR, 'sc-mcp-rows.json');
  const reviewPath = join(OUT_DIR, 'sc-mcp-review.csv');

  let scanned: number;
  let rows: SyncRow[];
  if (args.fromCache) {
    if (!existsSync(cachePath)) throw new Error(`No saved fetch at ${cachePath}. Run the sync without --from-cache first.`);
    const saved = JSON.parse(readFileSync(cachePath, 'utf8')) as { scanned: number; rows: SyncRow[] };
    ({ scanned, rows } = saved);
    console.log(`Using the saved fetch: ${rows.length} campaign contacts from ${scanned} conversations.`);
  } else {
    const client = await connect();
    try {
      ({ scanned, rows } = await fetchRows(client, args.limit));
    } finally {
      await client.close();
    }
    writeFileSync(cachePath, JSON.stringify({ scanned, rows }));
    console.log(`Fetched ${rows.length} campaign contacts from ${scanned} conversations. Saved to ${cachePath}`);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const actor = process.env.SC_SYNC_ACTOR_ID ?? null;
  const result = await loadRows(db, rows, args.apply, actor);
  writeReview(reviewPath, result.review);

  const reasons = new Map<string, number>();
  for (const r of result.review) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);

  console.log(`\n${args.apply ? 'Written to the database' : 'Preview only (nothing written)'}`);
  console.log(`  Campaign contacts:          ${result.rows_total}`);
  console.log(`  Matched to a property:      ${result.rows_matched}`);
  console.log(`  Needs review:               ${result.rows_review}`);
  for (const [reason, count] of reasons) console.log(`    - ${reason}: ${count}`);
  if (args.apply) {
    console.log(`  Phones linked:              ${result.phones_linked}`);
    console.log(`  Campaign contacts added:    ${result.contacts_linked}`);
    console.log(`  Opt-outs recorded:          ${result.opt_outs_recorded}`);
  }
  console.log(`  Review list:                ${reviewPath}`);
  if (!args.apply) console.log('\nRun again with --apply --from-cache to write these rows.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
