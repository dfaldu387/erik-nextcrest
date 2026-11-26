// SmarterContact sync, as a Supabase Edge Function (migrations 029 and 033). Uses the SmarterContact REST API (api.ts,
// built from api-1.yaml). Every enabled account in sc_accounts is read with its own sign-in and its own rate budget.
//
// Two jobs:
//   1. Cron (every minute, pg_cron): per account, the inbox (newest conversations, changed ones re-read, Unread,
//      Missed calls); hourly, the Opted out and Deleted folders; resumable scans of Unreplied and Awaiting reply
//      (primary account); then a batch of dates and labels per account. The result is saved in sc_sync_state under
//      'last_cycle'.
//   2. A signed-in user opens a conversation, sends a reply or marks read: the conversation's own account is used.
//
// Deploy:  npx supabase functions deploy smartercontact-sync --no-verify-jwt --project-ref <ref>
// Secrets: SC_CRON_SECRET
// Accounts (client ID and secret) are in table sc_accounts. Only this function (service role) can read it.
//
// Reads never mark anything read unless a person asks for it (the Inbox mark read action).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';
import { SmarterContactApi, SmarterContactApiError, type ConversationItem as ApiConversation, type Message } from './api.ts';
import {
  mergeInboxFolders,
  toInboxDetails,
  toMessageRow,
  type ConversationItem,
  type InboxFolder,
  type ListedConversation,
  type MessageRow,
  type ThreadItem,
} from './transform.ts';
import { checkFields, checkMark, checkReply, fieldIdsFor } from './actions.ts';

const TOKEN_URL = 'https://api.smartercontact.com/rest/integration/oauth2/token';
// Reads for the sync; conversations:write and messages:write for the Inbox actions (mark read, reply).
const SCOPES = 'contacts:read conversations:read conversations:write messages:write';
const PRIMARY = 'primary';
const CYCLE_LABEL_BATCH = 40;
const CYCLE_MESSAGES_BATCH = 30; // conversations read in full (last 50 messages) per cycle, all accounts together // conversations relabelled per cycle, all accounts together
const CYCLE_DETAILS_BATCH = 60; // conversations dated per cycle, all accounts together
const DETAILS_CONCURRENCY = 4;
const LABEL_REFRESH_DAYS = 1;
const MAX_CHANGED_PER_CYCLE = 10; // newest conversations re-read per account per cycle
const OPEN_COOLDOWN_MS = 60_000;
const OPEN_MESSAGE_LIMIT = 50;
const TOKEN_MARGIN_MS = 60_000;
const FOLDER_REFRESH_MS = 60 * 60_000; // Opted out and Deleted are re-listed this often
const CYCLE_TIME_LIMIT_MS = 100_000; // the function is stopped at 150 s of idle time; stop batches well before

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isRateLimited = (error: unknown) => error instanceof SmarterContactApiError && error.code === 'too_many_requests';

const db: SupabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const CRON_SECRET = Deno.env.get('SC_CRON_SECRET') ?? '';

// ---------- accounts and sign-in ----------

interface Account {
  id: string;
  label: string;
  client_id: string;
  client_secret: string;
  profile_id: string | null;
  access_token: string | null;
  access_expires_at: string | null;
  enabled: boolean;
}

async function loadAccounts(): Promise<Account[]> {
  const { data, error } = await db.from('sc_accounts').select('*').eq('enabled', true).order('id');
  if (error) throw new Error(`Could not load the accounts: ${error.message}`);
  return (data ?? []) as Account[];
}

async function getAccount(accountId: string): Promise<Account> {
  const { data, error } = await db.from('sc_accounts').select('*').eq('id', accountId).single();
  if (error || !data) throw new Error(`Account ${accountId} not found: ${error?.message ?? 'no row'}`);
  return data as Account;
}

// One renewal at a time per account, so two requests never renew the same account's token together.
const renewing = new Map<string, Promise<string>>();

function accessTokenFor(accountId: string, force = false): Promise<string> {
  const existing = renewing.get(accountId);
  if (existing) return existing;
  const pending = renewAccessToken(accountId, force).finally(() => renewing.delete(accountId));
  renewing.set(accountId, pending);
  return pending;
}

async function renewAccessToken(accountId: string, force: boolean): Promise<string> {
  const account = await getAccount(accountId);
  const expires = account.access_expires_at ? new Date(account.access_expires_at).getTime() : 0;
  if (!force && account.access_token && expires - Date.now() > TOKEN_MARGIN_MS) return account.access_token;

  // Client-credentials grant: a new access token about every hour, no browser step.
  const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: account.client_id, client_secret: account.client_secret, scope: SCOPES });
  const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; profileId?: string; error?: string; error_description?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(`SmarterContact sign-in failed for ${account.label} (${response.status}): ${body.error ?? 'no token'} ${body.error_description ?? ''}`.trim());
  }
  const { error: saveError } = await db
    .from('sc_accounts')
    .update({
      access_token: body.access_token,
      access_expires_at: new Date(Date.now() + (Number(body.expires_in) || 3600) * 1000).toISOString(),
      profile_id: body.profileId ?? account.profile_id,
    })
    .eq('id', accountId);
  if (saveError) throw new Error(`Could not save the sign-in for ${account.label}: ${saveError.message}`);
  return body.access_token;
}

const apis = new Map<string, SmarterContactApi>();

/** The REST client for one account. Each account has its own request pacing and rate budget. */
function apiFor(accountId: string): SmarterContactApi {
  let api = apis.get(accountId);
  if (!api) {
    api = new SmarterContactApi({ getAccessToken: (force) => accessTokenFor(accountId, force) });
    apis.set(accountId, api);
  }
  return api;
}

/** Which account a conversation belongs to. Unknown contacts use the primary account. */
async function accountOf(contactId: string): Promise<string> {
  const { data } = await db.from('smartercontact_conversations').select('account_id').eq('contact_id', contactId).maybeSingle();
  return (data?.account_id as string | undefined) ?? PRIMARY;
}

// ---------- mapping API shapes to the sync's shapes ----------

const toListed = (c: ApiConversation): ListedConversation => ({ contactId: c.contact_id, name: c.name, email: c.email, phone: c.phone });
const toThread = (m: Message): ThreadItem => ({
  id: m.id,
  direction: m.direction,
  type: m.type,
  content: m.content ?? '',
  createdAt: m.created_at,
  status: m.status,
  source: m.source,
  fromNumber: m.from_number,
  toNumber: m.to_number,
  attachments: m.attachments,
});

// ---------- database helpers ----------

async function getState<T>(key: string): Promise<T | null> {
  const { data } = await db.from('sc_sync_state').select('value').eq('key', key).maybeSingle();
  return (data?.value as T) ?? null;
}

async function setState(key: string, value: unknown): Promise<void> {
  const { error } = await db.from('sc_sync_state').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(`Could not save sync state: ${error.message}`);
}

/** Adds the listed conversations that are not in the record yet, tagged with the account they came from. */
async function addMissingConversations(accountId: string, lists: Partial<Record<InboxFolder, ListedConversation[]>>): Promise<void> {
  const rows = mergeInboxFolders(lists).map((r) => ({ ...r, account_id: accountId, updated_at: new Date().toISOString() }));
  if (rows.length === 0) return;
  const { error } = await db.from('smartercontact_conversations').upsert(rows, { onConflict: 'contact_id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

/** Saves the newest messages of one conversation and its last message in the Inbox. */
async function refreshConversation(accountId: string, contactId: string, limit: number): Promise<void> {
  const page = await apiFor(accountId).getMessages(contactId, { limit });
  const items = page.items.map(toThread);
  const rows = items.map((m) => toMessageRow(contactId, m)).filter((r): r is MessageRow => r !== null);
  if (rows.length > 0) {
    const { error } = await db.from('smartercontact_messages').upsert(rows, { onConflict: 'message_id' });
    if (error) throw new Error(error.message);
  }
  const details = toInboxDetails(items[0] as ConversationItem | undefined, [], new Map());
  if (details.last_message_at) {
    const { error } = await db
      .from('smartercontact_conversations')
      .update({ last_message: details.last_message, last_message_at: details.last_message_at, last_direction: details.last_direction, updated_at: new Date().toISOString() })
      .eq('contact_id', contactId);
    if (error) throw new Error(error.message);
  }
}

/** Keeps one folder of one account in step with the API: adds the folder to conversations now in it, removes it from the rest. */
async function syncFolder(accountId: string, folder: InboxFolder, max: number): Promise<number> {
  const listed = (await apiFor(accountId).listAllConversations(folder, max)).map(toListed);
  await addMissingConversations(accountId, { [folder]: listed });
  const inFolder = new Set(listed.map((i) => i.contactId));

  // Every conversation of this account that has the folder, read in pages.
  const flagged = new Map<string, string[]>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('smartercontact_conversations')
      .select('contact_id,folders')
      .eq('account_id', accountId)
      .contains('folders', [folder])
      .order('contact_id')
      .range(from, from + 999);
    if (error) throw new Error(`${folder} lookup failed: ${error.message}`);
    for (const row of data ?? []) flagged.set(row.contact_id as string, (row.folders as string[]) ?? []);
    if ((data ?? []).length < 1000) break;
  }

  for (const [id, folders] of flagged) {
    if (inFolder.has(id)) continue;
    await db.from('smartercontact_conversations').update({ folders: folders.filter((f) => f !== folder) }).eq('contact_id', id);
  }
  for (const id of inFolder) {
    if (flagged.has(id)) continue;
    const { data: row } = await db.from('smartercontact_conversations').select('folders').eq('contact_id', id).maybeSingle();
    if (row) await db.from('smartercontact_conversations').update({ folders: [...new Set([...((row.folders as string[]) ?? []), folder])] }).eq('contact_id', id);
  }
  return listed.length;
}

/** The Unread flag for one account: added to its conversations in SmarterContact's Unread folder, removed from the rest. */
async function syncUnreadFlags(accountId: string, unreadItems: ListedConversation[]): Promise<void> {
  const unreadIds = new Set(unreadItems.map((i) => i.contactId));
  await addMissingConversations(accountId, { unread: unreadItems });
  const { data: flagged, error } = await db
    .from('smartercontact_conversations')
    .select('contact_id,folders')
    .eq('account_id', accountId)
    .contains('folders', ['unread'])
    .limit(1000);
  if (error) throw new Error(`Unread flag lookup failed: ${error.message}`);
  const flaggedIds = new Set((flagged ?? []).map((r) => r.contact_id as string));

  for (const id of unreadIds) {
    if (flaggedIds.has(id)) continue;
    const { data: row } = await db.from('smartercontact_conversations').select('folders').eq('contact_id', id).maybeSingle();
    if (row) await db.from('smartercontact_conversations').update({ folders: [...new Set([...((row.folders as string[]) ?? []), 'unread'])] }).eq('contact_id', id);
  }
  for (const row of flagged ?? []) {
    const id = row.contact_id as string;
    if (unreadIds.has(id)) continue;
    await db.from('smartercontact_conversations').update({ folders: ((row.folders as string[]) ?? []).filter((f) => f !== 'unread') }).eq('contact_id', id);
  }
}

// ---------- the inbox cycle, per account ----------

async function inboxCycle(accountId: string): Promise<{ changed: number; unread: number; missedCalls: number; errors: string[] }> {
  const api = apiFor(accountId);
  const top = (await api.listConversations({ category: 'all', limit: MAX_CHANGED_PER_CYCLE })).items.map(toListed);
  await addMissingConversations(accountId, { all: top });
  const topIds = top.map((i) => i.contactId);

  const stateKey = `inbox_top:${accountId}`;
  const last = (await getState<string[]>(stateKey)) ?? [];
  const changed = topIds.filter((id) => !last.includes(id) || last.indexOf(id) > topIds.indexOf(id));
  const errors: string[] = [];
  for (const id of changed) {
    try {
      await refreshConversation(accountId, id, 5);
    } catch (error) {
      if (isRateLimited(error)) throw error;
      errors.push(`${id}: ${errorText(error)}`);
    }
  }
  await setState(stateKey, topIds);

  const unread = (await api.listAllConversations('unread', 100)).map(toListed);
  await syncUnreadFlags(accountId, unread);
  const missedCalls = await syncFolder(accountId, 'missed_calls', 2000);
  return { changed: changed.length, unread: unread.length, missedCalls, errors };
}

// ---------- resumable folder scans (Unreplied, Awaiting reply), primary account ----------

// A folder too large to list in one cycle is read a few pages per cycle. The position is saved between cycles.
// Conversations seen in a scan get the folder; when the scan finishes, the ones it did not see lose it.
const SCAN_FOLDERS: InboxFolder[] = ['unreplied', 'awaiting_reply'];
const SCAN_PAGES_PER_CYCLE = 20; // per folder, so the two scans use about 40 requests a minute
const SCAN_REPEAT_MS = 60 * 60_000; // a finished scan starts again after an hour

type ScanState = { cursor: string | null; startedAt: string | null; completedAt: string | null; pages: number };

async function scanFolderStep(folder: InboxFolder, deadline: number): Promise<Record<string, unknown>> {
  const api = apiFor(PRIMARY);
  const key = `folder_scan:${folder}`;
  let state = (await getState<ScanState>(key)) ?? { cursor: null, startedAt: null, completedAt: null, pages: 0 };
  if (!state.startedAt) {
    if (state.completedAt && Date.now() - new Date(state.completedAt).getTime() < SCAN_REPEAT_MS) return { status: 'waiting' };
    state = { cursor: null, startedAt: new Date().toISOString(), completedAt: state.completedAt, pages: 0 };
    await setState(key, state);
  }

  let pages = 0;
  let finished = false;
  try {
    while (pages < SCAN_PAGES_PER_CYCLE && Date.now() < deadline) {
      const page = await api.listConversations({ category: folder, limit: 100, nextPageToken: state.cursor ?? undefined });
      const listed = page.items.map(toListed);
      await addMissingConversations(PRIMARY, { [folder]: listed });
      if (listed.length > 0) {
        const { error } = await db.rpc('sc_mark_folder', { p_folder: folder, p_ids: listed.map((i) => i.contactId), p_seen: state.startedAt });
        if (error) throw new Error(`${folder} mark failed: ${error.message}`);
      }
      pages += 1;
      state = { ...state, cursor: page.next_page_token ?? null, pages: state.pages + 1 };
      await setState(key, state);
      if (!page.next_page_token) {
        finished = true;
        break;
      }
    }
  } catch (error) {
    // A page token the API no longer accepts: start this folder's scan again next cycle.
    if (error instanceof SmarterContactApiError && error.reason === 'invalid_page_token') {
      await setState(key, { cursor: null, startedAt: null, completedAt: state.completedAt, pages: 0 });
      return { status: 'restarted', reason: 'invalid_page_token' };
    }
    throw error;
  }

  if (finished) {
    const { data, error } = await db.rpc('sc_finish_folder', { p_folder: folder, p_seen: state.startedAt });
    if (error) throw new Error(`${folder} finish failed: ${error.message}`);
    await setState(key, { cursor: null, startedAt: null, completedAt: new Date().toISOString(), pages: 0 });
    return { status: 'finished', pages: state.pages, removed: data ?? 0 };
  }
  return { status: 'in progress', pages: state.pages };
}

// ---------- dates and labels, per account ----------

/** Reads the newest messages of conversations of one account whose date has never been read. */
async function detailsBatch(accountId: string, count: number, deadline: number): Promise<{ done: number; failed: number; rateLimited: boolean }> {
  // Missed calls first, then everything else of this account that has never been dated.
  const { data: missed, error: missedError } = await db
    .from('smartercontact_conversations')
    .select('contact_id')
    .eq('account_id', accountId)
    .is('details_synced_at', null)
    .contains('folders', ['missed_calls'])
    .limit(count);
  if (missedError) throw new Error(`Could not pick the missed calls to date: ${missedError.message}`);
  const { data: others, error } = await db.from('smartercontact_conversations').select('contact_id').eq('account_id', accountId).is('details_synced_at', null).limit(count);
  if (error) throw new Error(`Could not pick the next conversations to date: ${error.message}`);

  const seen = new Set<string>();
  const rows = [...(missed ?? []), ...(others ?? [])]
    .filter((r) => {
      const id = r.contact_id as string;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, count);

  let next = 0;
  let done = 0;
  let failed = 0;
  let rateLimited = false;
  const worker = async () => {
    while (!rateLimited && next < rows.length && Date.now() <= deadline) {
      const contactId = rows[next].contact_id as string;
      next += 1;
      try {
        await refreshConversation(accountId, contactId, 10);
        done += 1;
      } catch (error) {
        if (isRateLimited(error)) {
          rateLimited = true;
          return;
        }
        failed += 1;
      }
      await db.from('smartercontact_conversations').update({ details_synced_at: new Date().toISOString() }).eq('contact_id', contactId);
    }
  };
  await Promise.all(Array.from({ length: DETAILS_CONCURRENCY }, worker));
  return { done, failed, rateLimited };
}

/** Labels the next batch of conversations of one account: never labelled first, then the ones labelled longest ago. */
async function labelsBatch(accountId: string, count: number, deadline: number): Promise<{ done: number; failed: number; rateLimited: boolean }> {
  const api = apiFor(accountId);
  const names = await api.labelNames();
  const cutoff = new Date(Date.now() - LABEL_REFRESH_DAYS * 86_400_000).toISOString();
  const { data: due, error } = await db
    .from('smartercontact_conversations')
    .select('contact_id')
    .eq('account_id', accountId)
    .or(`labels_synced_at.is.null,labels_synced_at.lt.${cutoff}`)
    .order('labels_synced_at', { ascending: true, nullsFirst: true })
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(count);
  if (error) throw new Error(`Could not pick the next labels batch: ${error.message}`);

  let done = 0;
  let failed = 0;
  for (const row of due ?? []) {
    if (Date.now() > deadline) break;
    const contactId = row.contact_id as string;
    try {
      const contact = await api.getContact(contactId);
      const labels = (contact.label_ids ?? []).map((id) => names.get(id)).filter((n): n is string => !!n);
      const { error: updateError } = await db
        .from('smartercontact_conversations')
        .update({ labels, labels_synced_at: new Date().toISOString() })
        .eq('contact_id', contactId);
      if (updateError) throw new Error(updateError.message);
      done += 1;
    } catch (error) {
      if (isRateLimited(error)) return { done, failed, rateLimited: true };
      failed += 1;
    }
  }
  return { done, failed, rateLimited: false };
}

/**
 * Reads the last 50 messages of conversations of one account that have never been read in full. Outbound texts (the
 * campaign messages) are captured this way, so a property's marketing history is complete. Each conversation is stamped
 * after one attempt, so a failing one is not retried every cycle.
 */
async function messagesBatch(accountId: string, count: number, deadline: number): Promise<{ done: number; failed: number; rateLimited: boolean }> {
  const { data: rows, error } = await db
    .from('smartercontact_conversations')
    .select('contact_id')
    .eq('account_id', accountId)
    .is('messages_synced_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(count);
  if (error) throw new Error(`Could not pick the conversations to read in full: ${error.message}`);

  let done = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    if (Date.now() > deadline) break;
    const contactId = row.contact_id as string;
    try {
      await refreshConversation(accountId, contactId, 50);
      done += 1;
    } catch (error) {
      if (isRateLimited(error)) return { done, failed, rateLimited: true };
      failed += 1;
    }
    await db.from('smartercontact_conversations').update({ messages_synced_at: new Date().toISOString() }).eq('contact_id', contactId);
  }
  return { done, failed, rateLimited: false };
}

// ---------- the cron cycle ----------

async function runCycle(): Promise<Record<string, unknown>> {
  const started = Date.now();
  const deadline = started + CYCLE_TIME_LIMIT_MS;
  const summary: Record<string, unknown> = { at: new Date().toISOString() };
  let accounts: Account[] = [];
  try {
    accounts = await loadAccounts();
  } catch (error) {
    summary.accountsError = errorText(error);
  }

  // Inbox folders, each account with its own sign-in and rate budget.
  const inbox: Record<string, unknown> = {};
  for (const account of accounts) {
    try {
      inbox[account.id] = await inboxCycle(account.id);
    } catch (error) {
      inbox[`${account.id}Error`] = errorText(error);
    }
  }
  summary.inbox = inbox;

  // Opted out and Deleted, re-listed in full about once an hour for each account. The time is recorded when the refresh
  // starts, so a refresh that fails is not retried every minute.
  try {
    const stamp = await getState<string>('folders_synced_at');
    if (!stamp || Date.now() - new Date(stamp).getTime() > FOLDER_REFRESH_MS) {
      await setState('folders_synced_at', new Date().toISOString());
      const folders: Record<string, unknown> = {};
      for (const account of accounts) {
        folders[account.id] = { optedOut: await syncFolder(account.id, 'opted_out', 20000), deleted: await syncFolder(account.id, 'deleted', 2000) };
      }
      summary.folders = folders;
    }
  } catch (error) {
    summary.foldersError = errorText(error);
  }

  for (const folder of SCAN_FOLDERS) {
    try {
      summary[`scan_${folder}`] = await scanFolderStep(folder, deadline);
    } catch (error) {
      summary[`scan_${folder}Error`] = errorText(error);
    }
  }

  // Dates and labels: the batch is shared between the accounts, and every account gets a turn.
  const share = Math.max(1, accounts.length);
  const details: Record<string, unknown> = {};
  const labels: Record<string, unknown> = {};
  const messages: Record<string, unknown> = {};
  for (const account of accounts) {
    try {
      details[account.id] = await detailsBatch(account.id, Math.max(10, Math.floor(CYCLE_DETAILS_BATCH / share)), deadline);
    } catch (error) {
      details[`${account.id}Error`] = errorText(error);
    }
    try {
      messages[account.id] = await messagesBatch(account.id, Math.max(5, Math.floor(CYCLE_MESSAGES_BATCH / share)), deadline);
    } catch (error) {
      messages[`${account.id}Error`] = errorText(error);
    }
    try {
      labels[account.id] = await labelsBatch(account.id, Math.max(10, Math.floor(CYCLE_LABEL_BATCH / share)), deadline);
    } catch (error) {
      labels[`${account.id}Error`] = errorText(error);
    }
  }
  summary.details = details;
  summary.labels = labels;
  summary.messages = messages;
  try {
    const { data: matched, error: matchError } = await db.rpc('sc_match_conversations');
    if (matchError) throw new Error(matchError.message);
    summary.matchedConversations = matched;
    const { data: responders, error: responderError } = await db.rpc('sc_mark_responders');
    if (responderError) throw new Error(responderError.message);
    summary.respondersMarked = responders;
  } catch (error) {
    summary.matchError = errorText(error);
  }

  await setState('last_cycle', summary);
  return summary;
}

// ---------- signed-in user requests ----------

/** Only a signed-in NextCrest user can ask for these. Returns the error response, or null when the user is valid. */
async function requireUser(userToken: string): Promise<Response | null> {
  const { data: user, error } = await db.auth.getUser(userToken);
  if (error || !user.user) return json(401, { error: 'Sign in to NextCrest first.' });
  return null;
}

/** Turns a SmarterContact error into the response the app shows: its message, reason and wait time. */
function apiErrorResponse(error: unknown): Response {
  if (error instanceof SmarterContactApiError) {
    const status = error.status >= 400 && error.status < 600 ? error.status : 502;
    return json(status, { error: error.message, code: error.code, reason: error.reason, retry_after_seconds: error.retryAfterSeconds });
  }
  return json(502, { error: errorText(error) });
}

// The contact's custom fields (name, email, property and mailing address, APN, and so on), read from SmarterContact.
async function getFieldsAction(userToken: string, contactId: string | undefined): Promise<Response> {
  const denied = await requireUser(userToken);
  if (denied) return denied;
  if (typeof contactId !== 'string' || !/^[0-9a-f-]{36}$/i.test(contactId)) return json(400, { error: 'The conversation id is not valid.' });
  try {
    const accountId = await accountOf(contactId);
    const result = await apiFor(accountId).getContactFields(contactId);
    return json(200, { fields: result.fields.map((f) => ({ name: f.name, value: f.value ?? '' })) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Saves the contact's custom fields in SmarterContact. This changes live data there, so the form saves only when asked.
async function setFieldsAction(userToken: string, contactId: string | undefined, fields: unknown): Promise<Response> {
  const denied = await requireUser(userToken);
  if (denied) return denied;
  const problem = checkFields(contactId, fields);
  if (problem) return json(400, { error: problem });
  try {
    const accountId = await accountOf(contactId!);
    const api = apiFor(accountId);
    const current = await api.getContactFields(contactId!);
    const mapped = fieldIdsFor(current.fields, fields as Record<string, string>);
    if ('missing' in mapped) return json(400, { error: `This contact has no field: ${mapped.missing.join(', ')}.` });
    await api.setContactFields(contactId!, mapped.ids);
    return json(200, { ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

async function sendReplyAction(userToken: string, contactId: string | undefined, content: string | undefined): Promise<Response> {
  const denied = await requireUser(userToken);
  if (denied) return denied;
  const problem = checkReply(contactId, content);
  if (problem) return json(400, { error: problem });

  try {
    const accountId = await accountOf(contactId!);
    const message = await apiFor(accountId).sendReply(contactId!, content!.trim());
    const row = toMessageRow(contactId!, toThread(message));
    if (row) {
      const { error } = await db.from('smartercontact_messages').upsert([row], { onConflict: 'message_id' });
      if (error) throw new Error(error.message);
    }
    await db
      .from('smartercontact_conversations')
      .update({ last_message: content!.trim().slice(0, 500), last_message_at: message.created_at, last_direction: 'outgoing', updated_at: new Date().toISOString() })
      .eq('contact_id', contactId!);
    return json(200, { ok: true, message_id: message.id });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

async function markAction(userToken: string, contactIds: string[] | undefined, read: boolean | undefined): Promise<Response> {
  const denied = await requireUser(userToken);
  if (denied) return denied;
  const problem = checkMark(contactIds, read);
  if (problem) return json(400, { error: problem });

  try {
    // Each conversation is marked through its own account.
    const byAccount = new Map<string, string[]>();
    for (const id of contactIds!) {
      const accountId = await accountOf(id);
      byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), id]);
    }
    for (const [accountId, ids] of byAccount) {
      await apiFor(accountId).setConversationsRead(ids, read!);
    }
    // The Unread folder follows the change at once; the next cycle confirms it against SmarterContact.
    for (const id of contactIds!) {
      const { data: row } = await db.from('smartercontact_conversations').select('folders').eq('contact_id', id).maybeSingle();
      if (!row) continue;
      const folders = ((row.folders as string[]) ?? []).filter((f) => f !== 'unread');
      if (!read) folders.push('unread');
      await db.from('smartercontact_conversations').update({ folders: [...new Set(folders)] }).eq('contact_id', id);
    }
    return json(200, { ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

async function openConversation(contactId: string, userToken: string): Promise<Response> {
  const { data: user, error } = await db.auth.getUser(userToken);
  if (error || !user.user) return json(401, { error: 'Sign in to NextCrest first.' });

  const { data: last } = await db.from('sc_open_refresh').select('refreshed_at').eq('contact_id', contactId).maybeSingle();
  if (last && Date.now() - new Date(last.refreshed_at as string).getTime() < OPEN_COOLDOWN_MS) {
    return json(200, { ok: true, cached: true });
  }
  await db.from('sc_open_refresh').upsert({ contact_id: contactId, refreshed_at: new Date().toISOString() }, { onConflict: 'contact_id' });
  try {
    await refreshConversation(await accountOf(contactId), contactId, OPEN_MESSAGE_LIMIT);
    return json(200, { ok: true, cached: false });
  } catch (refreshError) {
    await db.from('sc_open_refresh').delete().eq('contact_id', contactId); // allow a retry on the next open
    return apiErrorResponse(refreshError);
  }
}

// ---------- accounts (admins only) ----------

/** Only an admin can add, list or switch off SmarterContact accounts. */
async function requireAdmin(userToken: string): Promise<{ userId: string } | Response> {
  const { data: user, error } = await db.auth.getUser(userToken);
  if (error || !user.user) return json(401, { error: 'Sign in to NextCrest first.' });
  const { data: profile } = await db.from('profiles').select('role').eq('id', user.user.id).maybeSingle();
  if (profile?.role !== 'admin') return json(403, { error: 'Only an admin can manage SmarterContact accounts.' });
  return { userId: user.user.id };
}

interface AccountBody { action?: string; id?: string; label?: string; clientId?: string; clientSecret?: string; enabled?: boolean }

async function accountsAction(userToken: string, body: AccountBody): Promise<Response> {
  const admin = await requireAdmin(userToken);
  if (admin instanceof Response) return admin;

  if (body.action === 'accounts-list') {
    const { data, error } = await db.from('sc_accounts').select('id,label,profile_id,enabled,access_expires_at,created_at').order('created_at');
    if (error) return json(500, { error: error.message });
    return json(200, {
      accounts: (data ?? []).map((a) => ({ id: a.id, label: a.label, profileId: a.profile_id, enabled: a.enabled, accessExpiresAt: a.access_expires_at })),
    });
  }

  if (body.action === 'accounts-add') {
    const label = (body.label ?? '').trim();
    const clientId = (body.clientId ?? '').trim();
    const clientSecret = (body.clientSecret ?? '').trim();
    if (!label || label.length > 60) return json(400, { error: 'Give the account a name of up to 60 characters.' });
    if (!clientId || !clientSecret) return json(400, { error: 'Enter the client ID and the client secret.' });

    // Check the credentials with SmarterContact before anything is saved.
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: SCOPES }),
    });
    const tokenBody = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; profileId?: string; error?: string; error_description?: string };
    if (!response.ok || !tokenBody.access_token) {
      return json(400, { error: `SmarterContact did not accept these credentials (${response.status}): ${tokenBody.error_description ?? tokenBody.error ?? 'no token'}.` });
    }

    // One SmarterContact account is connected once.
    if (tokenBody.profileId) {
      const { data: existing } = await db.from('sc_accounts').select('label').eq('profile_id', tokenBody.profileId).maybeSingle();
      if (existing) return json(409, { error: `This SmarterContact account is already connected as "${existing.label}".` });
    }

    const id = `acc-${crypto.randomUUID().slice(0, 8)}`;
    const { error } = await db.from('sc_accounts').insert({
      id,
      label,
      client_id: clientId,
      client_secret: clientSecret,
      profile_id: tokenBody.profileId ?? null,
      access_token: tokenBody.access_token,
      access_expires_at: new Date(Date.now() + (Number(tokenBody.expires_in) || 3600) * 1000).toISOString(),
      enabled: true,
    });
    if (error) return json(500, { error: `The account could not be saved: ${error.message}` });
    return json(200, { ok: true, id, profileId: tokenBody.profileId ?? null });
  }

  if (body.action === 'accounts-toggle') {
    if (!body.id || typeof body.enabled !== 'boolean') return json(400, { error: 'Choose an account and whether it is on.' });
    const { error } = await db.from('sc_accounts').update({ enabled: body.enabled }).eq('id', body.id);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(400, { error: 'Unknown account action.' });
}

/** Re-lists the Opted out folder of every enabled account, so an export never uses an older list. */
async function refreshOptOuts(): Promise<Response> {
  const accounts = await loadAccounts();
  const perAccount: Record<string, number> = {};
  for (const account of accounts) {
    perAccount[account.id] = await syncFolder(account.id, 'opted_out', 20000);
  }
  await setState('folders_synced_at', new Date().toISOString());
  const { count } = await db.from('smartercontact_conversations').select('*', { count: 'exact', head: true }).contains('folders', ['opted_out']);
  return json(200, { ok: true, refreshedAt: new Date().toISOString(), perAccount, optedOutInRecord: count ?? 0 });
}

// ---------- entry point ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const cronHeader = req.headers.get('x-cron-secret') ?? '';
  if (CRON_SECRET && cronHeader === CRON_SECRET) {
    return json(200, await runCycle());
  }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Not signed in.' });
  const body = (await req.json().catch(() => ({}))) as { action?: string; contactId?: string; content?: string; contactIds?: string[]; read?: boolean; id?: string; label?: string; clientId?: string; clientSecret?: string; enabled?: boolean };

  if (body.action?.startsWith('accounts-')) return accountsAction(token, body);
  if (body.action === 'refresh-opt-outs') {
    const { data: user, error: userError } = await db.auth.getUser(token);
    if (userError || !user.user) return json(401, { error: 'Sign in to NextCrest first.' });
    try {
      return await refreshOptOuts();
    } catch (error) {
      return json(502, { error: `The opt-out list could not be refreshed: ${errorText(error)}` });
    }
  }
  if (body.action === 'get-fields') return getFieldsAction(token, body.contactId);
  if (body.action === 'set-fields') return setFieldsAction(token, body.contactId, (body as { fields?: unknown }).fields);
  if (body.action === 'reply') return sendReplyAction(token, body.contactId, body.content);
  if (body.action === 'mark') return markAction(token, body.contactIds, body.read);
  if (!body.contactId) return json(400, { error: 'contactId is required.' });
  return openConversation(body.contactId, token);
});
