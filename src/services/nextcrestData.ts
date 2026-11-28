import type { ActivityEvent, DataResult, LandRecord, Market } from '@/data/types';
import { supabase } from '@/lib/supabase';
import {
  type PropertyRow,
  type PropertySearchRow,
  toLandRecord,
  toLandRecordFromSearch,
} from '@/lib/propertyRecords';
import { buildMarkets, marketLabel } from '@/lib/metrics';
import { normalizePhone } from '@/lib/campaignExport';
import { DEFAULT_FOLLOW_UP_RULES, getFollowUpRules, setFollowUpRules, type FollowUpRules } from '@/lib/followUp';
import { chunk, type PropertyInsert } from '@/lib/importCommit';
import type { PhoneLink } from '@/lib/phones';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { InboxFilters } from '@/lib/inboxFilters';
import { runQueue, withRetry } from '@/lib/insertQueue';

// Single data boundary for the UI. Screens call these functions and never query the database directly.
// Reads go through the browser client, so row-level security applies: a visitor who is not signed in
// sees no rows.

const PAGE_SIZE = 1000;

function wrap<T>(data: T, source: DataResult<T>['source']): Promise<DataResult<T>> {
  return Promise.resolve({ data, source, fetchedAt: new Date().toISOString() });
}

// PostgREST returns at most 1000 rows per request, so read the table page by page.
async function fetchAllProperties(): Promise<PropertyRow[]> {
  if (!supabase) return [];
  const rows: PropertyRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('properties')
      .select(
        'id,internal_id,apn_raw,state,county,zip_code,acreage,owner_name,owner_type,marketing_status,total_contacts,last_contacted_at,first_acquired_at,created_at,property_owners(phone_numbers),property_phones(phone_numbers(phone_number))',
      )
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load properties: ${error.message}`);
    const page = (data ?? []) as unknown as PropertyRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

// One property, with the same fields the list uses. The property page reads this instead of the whole list.
export async function getPropertyRecord(id: string): Promise<LandRecord | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('properties')
    .select(
      'id,internal_id,apn_raw,state,county,zip_code,acreage,owner_name,owner_type,marketing_status,total_contacts,last_contacted_at,first_acquired_at,created_at,property_owners(phone_numbers),property_phones(phone_numbers(phone_number))',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the property: ${error.message}`);
  return data ? toLandRecord(data as unknown as PropertyRow) : null;
}

// The county's market id and name, built in the database from the county's properties (migration 040).
export async function getCountyMarket(state: string, county: string): Promise<{ id: string; name: string } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('property_county_summary', { p_state: state, p_county: county });
  if (error) throw new Error(`Could not load the county: ${error.message}`);
  const summary = data as { total: number; min_acres: number | null; max_acres: number | null; first_acquired: string | null } | null;
  if (!summary || !summary.total || summary.min_acres === null || summary.max_acres === null || !summary.first_acquired) return null;
  return marketLabel(state, county, Math.floor(summary.min_acres), Math.ceil(summary.max_acres), summary.first_acquired, Number(summary.total));
}

let recordsCache: Promise<LandRecord[]> | null = null;

// Called when the signed-in user changes, so rows loaded for one user are not shown to another.
export function clearRecordsCache(): void {
  recordsCache = null;
}

async function loadRecords(): Promise<LandRecord[]> {
  if (!recordsCache) {
    recordsCache = fetchAllProperties().then((rows) => rows.map(toLandRecord));
    // Do not keep a failed load: the next request should try again.
    recordsCache.catch(() => {
      recordsCache = null;
    });
  }
  return recordsCache;
}

// The follow-up rules set on the Settings page (migration 036). Loaded before the records, so the statuses use them.
export async function loadFollowUpRules(): Promise<FollowUpRules> {
  if (!supabase) return getFollowUpRules();
  try {
    const { data, error } = await supabase.from('sc_follow_up_rules').select('quiet_days,max_contacts,rehit_days').eq('id', 1).maybeSingle();
    if (error || !data) return getFollowUpRules();
    const rules: FollowUpRules = { quietDays: data.quiet_days as number, maxContacts: data.max_contacts as number, rehitDays: data.rehit_days as number };
    setFollowUpRules(rules);
    return rules;
  } catch {
    return getFollowUpRules();
  }
}

/** Saves new follow-up rules. Only an admin's change is saved (the database checks the role); anyone else gets a message. */
export async function saveFollowUpRules(rules: FollowUpRules): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'NextCrest is not connected to its database.' };
  const { data, error } = await supabase
    .from('sc_follow_up_rules')
    .update({ quiet_days: rules.quietDays, max_contacts: rules.maxContacts, rehit_days: rules.rehitDays, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('id');
  if (error) return { ok: false, message: `The rules could not be saved: ${error.message}` };
  if (!data || data.length === 0) return { ok: false, message: 'Only an admin can change the follow-up rules.' };
  setFollowUpRules(rules);
  return { ok: true };
}

export { DEFAULT_FOLLOW_UP_RULES };

export async function getRecords(): Promise<DataResult<LandRecord[]>> {
  await loadFollowUpRules();
  const records = await loadRecords();
  return wrap(records, supabase ? 'supabase' : 'none');
}

/**
 * Sets the labels of one conversation in NextCrest only (set_conversation_labels_local, migration 057).
 * SmarterContact is not changed. The sync keeps these labels instead of SmarterContact's.
 */
export async function setConversationLabelsLocal(contactId: string, labels: string[]): Promise<string[]> {
  if (!supabase) throw new Error('NextCrest is not connected to its database.');
  const { data, error } = await supabase.rpc('set_conversation_labels_local', { p_contact_id: contactId, p_labels: labels });
  if (error) throw new Error(`Labels were not saved: ${error.message}`);
  return (data ?? []) as string[];
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The SmarterContact labels of each property: the labels of every conversation linked to it (sc_conversation_properties).
 * Properties with no labelled conversation are left out of the result.
 */
export async function getPropertyLabels(propertyIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (!supabase || propertyIds.length === 0) return out;
  const client = supabase;

  const links: { property_id: string; contact_id: string }[] = [];
  for (const part of chunked(propertyIds, 100)) {
    const { data, error } = await client.from('sc_conversation_properties').select('property_id,contact_id').in('property_id', part);
    if (error) throw new Error(`Could not load property labels: ${error.message}`);
    links.push(...((data ?? []) as { property_id: string; contact_id: string }[]));
  }

  const labelsByContact = new Map<string, string[]>();
  const contactIds = [...new Set(links.map((l) => l.contact_id))];
  for (const part of chunked(contactIds, 100)) {
    const { data, error } = await client.from('smartercontact_conversations').select('contact_id,labels').in('contact_id', part);
    if (error) throw new Error(`Could not load property labels: ${error.message}`);
    for (const row of (data ?? []) as { contact_id: string; labels: string[] | null }[]) {
      labelsByContact.set(row.contact_id, row.labels ?? []);
    }
  }

  for (const link of links) {
    const labels = labelsByContact.get(link.contact_id) ?? [];
    if (labels.length === 0) continue;
    out[link.property_id] = [...new Set([...(out[link.property_id] ?? []), ...labels])].sort();
  }
  return out;
}

/** Every property matching the query (filters, search and account), read in pages of 1000 up to cap. */
export async function exportProperties(query: Omit<PropertyQuery, 'page' | 'pageSize'>, cap = 20000): Promise<LandRecord[]> {
  const rows: LandRecord[] = [];
  for (let page = 1; rows.length < cap; page++) {
    const result = await searchProperties({ ...query, page, pageSize: 1000 });
    rows.push(...result.rows);
    if (result.rows.length < 1000 || rows.length >= result.total) break;
  }
  return rows.slice(0, cap);
}

// The property ids of one SmarterContact account (account_property_ids, migration 052), read in pages of 1000.
export async function getAccountPropertyIds(accountId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!supabase) return ids;
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.rpc('account_property_ids', { p_account_id: accountId }).range(from, from + pageSize - 1);
    if (error) throw new Error(`Could not load this account's properties: ${error.message}`);
    const rows = (data ?? []) as string[];
    for (const id of rows) ids.add(id);
    if (rows.length < pageSize) break;
  }
  return ids;
}

export async function getMarkets(): Promise<DataResult<Market[]>> {
  const records = await loadRecords();
  return wrap(buildMarkets(records), supabase ? 'supabase' : 'none');
}

export type PropertySort = 'apn' | 'owner' | 'county' | 'acres' | 'status' | 'times' | 'last';

export interface PropertyQuery {
  search: string;
  status: string;
  state: string;
  county: string;
  zips?: string[]; // 5-digit ZIP codes; missing or empty means no ZIP filter
  sort: PropertySort;
  dir: 'asc' | 'desc';
  page: number; // 1-based
  pageSize: number;
  accountId?: string | null; // SmarterContact account; only its linked properties. Missing means all properties.
}

export interface PropertyPage {
  rows: LandRecord[];
  total: number;
}

// One page of properties. Search, filters, sorting and paging all run in the database
// (search_properties in supabase/migrations/007_properties_search.sql).
export async function searchProperties(query: PropertyQuery): Promise<PropertyPage> {
  if (!supabase) return { rows: [], total: 0 };
  const { data, error } = await supabase.rpc('search_properties', {
    p_search: query.search.trim() || null,
    p_status: query.status || null,
    p_state: query.state || null,
    p_county: query.county || null,
    p_zips: query.zips && query.zips.length > 0 ? query.zips : null,
    p_sort: query.sort,
    p_dir: query.dir,
    p_limit: query.pageSize,
    p_offset: (query.page - 1) * query.pageSize,
    // Sent only when an account is chosen, so the list keeps working before migration 050 is applied.
    ...(query.accountId ? { p_account_id: query.accountId } : {}),
  });
  if (error) throw new Error(`Could not load properties: ${error.message}`);
  const rows = (data ?? []) as PropertySearchRow[];
  return {
    rows: rows.map(toLandRecordFromSearch),
    total: rows.length > 0 ? Number(rows[0].total_count) : 0,
  };
}

export interface PropertyFilterOptions {
  total: number;
  places: { state: string; county: string }[];
  zips: { state: string; county: string; zip: string }[];
}

// Counts, state/county pairs and state/county/ZIP triples for the filter dropdowns (property_filter_options, migrations 007 and 019).
export async function getPropertyFilterOptions(): Promise<PropertyFilterOptions> {
  if (!supabase) return { total: 0, places: [], zips: [] };
  const { data, error } = await supabase.rpc('property_filter_options');
  if (error) throw new Error(`Could not load property filters: ${error.message}`);
  const value = (data ?? {}) as {
    total?: number;
    places?: { state: string; county: string }[];
    zips?: { state: string; county: string; zip: string }[];
  };
  return { total: Number(value.total ?? 0), places: value.places ?? [], zips: value.zips ?? [] };
}

// ---------- Inbox (SmarterContact Messenger folders, migration 021) ----------

export type InboxFolderKey = 'all' | 'unread' | 'missed_calls' | 'unreplied' | 'awaiting_reply' | 'opted_out' | 'deleted';

export const INBOX_FOLDER_OPTIONS: { key: InboxFolderKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'missed_calls', label: 'Missed calls' },
  { key: 'unreplied', label: 'Unreplied' },
  { key: 'awaiting_reply', label: 'Awaiting reply' },
  { key: 'opted_out', label: 'Opted out' },
  { key: 'deleted', label: 'Deleted' },
];

export interface InboxRecord {
  contactId: string;
  name: string;
  email: string;
  phone: string;
  folders: InboxFolderKey[];
  propertyId: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastDirection: string | null;
  labels: string[];
  /** How many properties the conversation is linked to (the owner's properties on the same phone or owner key). */
  propertyCount: number;
  /** The owner name of the linked property, used when the conversation has no name. */
  ownerName: string;
}

export type InboxSortKey = 'name' | 'last_message' | 'last_message_at';

export interface InboxQuery {
  folder: InboxFolderKey;
  search: string;
  filters: InboxFilters;
  sortKey: InboxSortKey;
  sortDir: 'asc' | 'desc';
  page: number; // 1-based
  pageSize: number;
  /** The SmarterContact account to show. Missing or null means all accounts. */
  accountId?: string | null;
}

const INBOX_SELECT = 'contact_id,name,email,phone,folders,property_id,last_message,last_message_at,last_direction,labels';

// A Postgres text[] literal, with each value quoted and escaped.
function pgTextArray(values: string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}

// Local midnight at the start of a calendar day (YYYY-MM-DD), as an instant.
function localDayStart(day: string, addDays = 0): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d + addDays).toISOString();
}

// The folder, search, Filter contacts choices and sort, applied to one query on smartercontact_conversations.
function inboxRequest(query: Omit<InboxQuery, 'page' | 'pageSize'>) {
  if (!supabase) return null;
  const f = query.filters;
  let request = supabase.from('smartercontact_conversations').select(INBOX_SELECT, { count: 'exact' }).contains('folders', [query.folder]);
  if (query.accountId) request = request.eq('account_id', query.accountId);

  const term = query.search.trim().replace(/[%,()*]/g, ' ').trim();
  if (term) request = request.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);

  if (f.includeLabels.length > 0) {
    request = f.includeMode === 'all' ? request.contains('labels', f.includeLabels) : request.overlaps('labels', f.includeLabels);
  }
  if (f.excludeLabels.length > 0) {
    // Exclude contacts with any of the labels, or (mode all) only those that have every one of them.
    request =
      f.excludeMode === 'all'
        ? request.not('labels', 'cs', pgTextArray(f.excludeLabels))
        : request.not('labels', 'ov', pgTextArray(f.excludeLabels));
  }
  if (f.responseFrom) request = request.gte('last_message_at', localDayStart(f.responseFrom));
  if (f.responseTo) request = request.lt('last_message_at', localDayStart(f.responseTo, 1));
  if (f.areaCodes.length > 0) request = request.or(f.areaCodes.map((code) => `phone.like.${code}*`).join(','));
  if (f.propertyMatch === 'matched') request = request.not('property_id', 'is', null);
  if (f.propertyMatch === 'unmatched') request = request.is('property_id', null);
  if (f.minProperties > 0) request = request.gte('property_count', f.minProperties);

  const column = query.sortKey;
  return request.order(column, { ascending: query.sortDir === 'asc', nullsFirst: false }).order('name', { ascending: true });
}

function toInboxRecord(row: Record<string, unknown>): InboxRecord {
  return {
    contactId: row.contact_id as string,
    name: (row.name as string) ?? '',
    email: (row.email as string | null) ?? '',
    phone: (row.phone as string | null) ?? '',
    folders: (row.folders as InboxFolderKey[]) ?? [],
    propertyId: (row.property_id as string | null) ?? null,
    lastMessage: (row.last_message as string | null) ?? null,
    lastMessageAt: (row.last_message_at as string | null) ?? null,
    lastDirection: (row.last_direction as string | null) ?? null,
    labels: (row.labels as string[] | null) ?? [],
    propertyCount: 0,
    ownerName: '',
  };
}

export interface ThreadMessage {
  id: string;
  direction: 'incoming' | 'outgoing';
  type: string;
  content: string;
  status: string | null;
  source: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  attachmentCount: number;
  attachments: { index: number; contentType: string; url: string }[];
  createdAt: string;
}

// The stored messages of one conversation, oldest first (migration 026, filled by --inbox-messages).
export async function getConversationMessages(contactId: string): Promise<ThreadMessage[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('smartercontact_messages')
    .select('message_id,direction,type,content,status,source,from_number,to_number,attachment_count,attachments,created_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw new Error(`Could not load messages: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.message_id as string,
    direction: row.direction as 'incoming' | 'outgoing',
    type: (row.type as string) ?? 'sms',
    content: (row.content as string) ?? '',
    status: (row.status as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    fromNumber: (row.from_number as string | null) ?? null,
    toNumber: (row.to_number as string | null) ?? null,
    attachmentCount: (row.attachment_count as number) ?? 0,
    attachments: ((row.attachments as { index?: number; content_type?: string; url?: string }[] | null) ?? [])
      .filter((a) => !!a.url)
      .map((a, position) => ({ index: a.index ?? position, contentType: a.content_type ?? 'application/octet-stream', url: a.url as string })),
    createdAt: row.created_at as string,
  }));
}

export interface PropertySummary {
  id: string;
  apn: string;
  owner: string;
  county: string;
  state: string;
  acres: number | null;
  marketingStatus: string | null;
  totalContacts: number;
  lastContactedAt: string | null;
}

// The property record details for a set of property IDs (keyed by ID), used by the follow-up list.
export async function getPropertySummaries(ids: string[]): Promise<Record<string, PropertySummary>> {
  const out: Record<string, PropertySummary> = {};
  if (!supabase || ids.length === 0) return out;
  const { data, error } = await supabase
    .from('properties')
    .select('id,apn_raw,internal_id,owner_name,county,state,acreage,marketing_status,total_contacts,last_contacted_at')
    .in('id', ids);
  if (error) throw new Error(`Could not load property records: ${error.message}`);
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const id = row.id as string;
    out[id] = {
      id,
      apn: (row.apn_raw as string | null) ?? (row.internal_id as string) ?? '',
      owner: (row.owner_name as string | null) ?? '',
      county: (row.county as string | null) ?? '',
      state: (row.state as string | null) ?? '',
      acres: row.acreage === null || row.acreage === undefined ? null : Number(row.acreage),
      marketingStatus: (row.marketing_status as string | null) ?? null,
      totalContacts: Number(row.total_contacts ?? 0),
      lastContactedAt: (row.last_contacted_at as string | null) ?? null,
    };
  }
  return out;
}

// Label names and area codes that exist in the inbox, for the filter pickers (migration 023).
export async function getInboxFilterOptions(): Promise<{ labels: string[]; areaCodes: string[] }> {
  if (!supabase) return { labels: [], areaCodes: [] };
  const [labels, areas] = await Promise.all([supabase.rpc('inbox_label_names'), supabase.rpc('inbox_area_codes')]);
  if (labels.error) throw new Error(`Could not load inbox labels: ${labels.error.message}`);
  if (areas.error) throw new Error(`Could not load inbox area codes: ${areas.error.message}`);
  return { labels: (labels.data ?? []) as string[], areaCodes: (areas.data ?? []) as string[] };
}

// Every conversation that matches the current folder, search, filters and sort, for CSV export (capped).
export async function exportInbox(query: Omit<InboxQuery, 'page' | 'pageSize'>, cap = 20000): Promise<InboxRecord[]> {
  const rows: InboxRecord[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const request = inboxRequest(query);
    if (!request) return rows;
    const { data, error } = await request.range(from, from + 999);
    if (error) throw new Error(`Could not export the inbox: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, unknown>[]).map(toInboxRecord));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

// Phone numbers that must not be texted, as 10 digits: the SmarterContact Opted Out folder (synced conversations)
// and the suppression list: opt-outs, wrong numbers and Do Not Call numbers from imports. Read in pages of 1,000 rows.
export async function getSuppressedPhones(): Promise<Set<string>> {
  const phones = new Set<string>();
  if (!supabase) return phones;
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('smartercontact_conversations')
      .select('contact_id,phone')
      .contains('folders', ['opted_out'])
      .order('contact_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Opted-out contacts could not be loaded: ${error.message}`);
    for (const row of data ?? []) if (row.phone) phones.add(normalizePhone(row.phone as string));
    if ((data ?? []).length < pageSize) break;
  }

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('phone_suppressions')
      .select('id,phone_numbers(phone_number)')
      .in('suppression_type', ['opt_out', 'wrong_number', 'dnc'])
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`The suppression list could not be loaded: ${error.message}`);
    for (const row of (data ?? []) as unknown as { phone_numbers: { phone_number: string } | null }[]) {
      const number = row.phone_numbers?.phone_number;
      if (number) phones.add(normalizePhone(number));
    }
    if ((data ?? []).length < pageSize) break;
  }

  phones.delete('');
  return phones;
}

// How many conversations are in each folder. A conversation can be in several folders.
export async function getInboxCounts(accountId: string | null = null): Promise<Record<InboxFolderKey, number>> {
  const counts = Object.fromEntries(INBOX_FOLDER_OPTIONS.map((f) => [f.key, 0])) as Record<InboxFolderKey, number>;
  if (!supabase) return counts;
  // All folder counts at once (one request each), instead of one after another.
  const client = supabase;
  const results = await Promise.all(
    INBOX_FOLDER_OPTIONS.map((folder) => {
      let request = client.from('smartercontact_conversations').select('contact_id', { count: 'exact', head: true }).contains('folders', [folder.key]);
      if (accountId) request = request.eq('account_id', accountId);
      return request;
    }),
  );
  INBOX_FOLDER_OPTIONS.forEach((folder, index) => {
    const { count, error } = results[index];
    if (error) throw new Error(`Could not load inbox counts: ${error.message}`);
    counts[folder.key] = count ?? 0;
  });
  return counts;
}

// One page of a folder, filtered by name or phone, with the total and the time of the last sync.
export async function listInbox(query: InboxQuery): Promise<{ rows: InboxRecord[]; total: number; lastSynced: string | null }> {
  if (!supabase) return { rows: [], total: 0, lastSynced: null };
  const request = inboxRequest(query);
  if (!request) return { rows: [], total: 0, lastSynced: null };
  const from = (query.page - 1) * query.pageSize;
  // The page and the "last synced" time are asked for at the same time.
  const [{ data, error, count }, { data: latest }] = await Promise.all([
    request.range(from, from + query.pageSize - 1),
    supabase.from('smartercontact_conversations').select('updated_at').order('updated_at', { ascending: false }).limit(1),
  ]);
  if (error) throw new Error(`Could not load the inbox: ${error.message}`);

  const rows = ((data ?? []) as Record<string, unknown>[]).map(toInboxRecord);
  if (rows.length > 0) {
    // How many properties each conversation on this page is linked to, for the owner's property count.
    const { data: links } = await supabase
      .from('sc_conversation_properties')
      .select('contact_id,properties(owner_name)')
      .in('contact_id', rows.map((r) => r.contactId));
    const counts = new Map<string, number>();
    const owners = new Map<string, string>();
    for (const link of (links ?? []) as unknown as { contact_id: string; properties: { owner_name: string | null } | null }[]) {
      counts.set(link.contact_id, (counts.get(link.contact_id) ?? 0) + 1);
      if (!owners.has(link.contact_id) && link.properties?.owner_name) owners.set(link.contact_id, link.properties.owner_name);
    }
    for (const row of rows) {
      row.propertyCount = counts.get(row.contactId) ?? 0;
      row.ownerName = owners.get(row.contactId) ?? '';
    }
  }

  return {
    rows,
    total: count ?? 0,
    lastSynced: (latest?.[0]?.updated_at as string | undefined) ?? null,
  };
}

// Every owned parcel in one state and county, reading only the APN columns (for the exclusion file).
export async function getOwnedParcels(state: string, county: string): Promise<{ apn: string; state: string; county: string }[]> {
  if (!supabase) return [];
  const parcels: { apn: string; state: string; county: string }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('properties')
      .select('id,apn_raw,internal_id,state,county')
      .eq('state', state)
      .eq('county', county)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load parcels: ${error.message}`);
    const page = data ?? [];
    for (const row of page) {
      parcels.push({ apn: row.apn_raw ?? row.internal_id, state: row.state, county: row.county ?? '' });
    }
    if (page.length < PAGE_SIZE) break;
  }
  return parcels;
}

export interface ExclusionExportRecord {
  id: string;
  created_at: string;
  state: string;
  counties: string[];
  parcel_count: number;
  filename: string;
  file_format: string;
  matching_rule_version: string;
}

// Saves one row per exclusion file generated (supabase/migrations/008_exclusion_exports.sql).
// created_by is filled in by the database from the signed-in user.
export async function recordExclusionExport(input: {
  state: string;
  counties: string[];
  parcelCount: number;
  filename: string;
}): Promise<void> {
  if (!supabase) throw new Error('The database is not connected, so the export was not recorded.');
  const { error } = await supabase.from('exclusion_exports').insert({
    state: input.state,
    counties: input.counties,
    parcel_count: input.parcelCount,
    filename: input.filename,
  });
  if (error) throw new Error(`The export was downloaded but could not be recorded: ${error.message}`);
}

// Most recent exclusion files first.
export async function listExclusionExports(limit = 100): Promise<ExclusionExportRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('exclusion_exports')
    .select('id,created_at,state,counties,parcel_count,filename,file_format,matching_rule_version')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load export history: ${error.message}`);
  return (data ?? []) as ExclusionExportRecord[];
}

export interface ImportBatchRecord {
  id: string;
  created_at: string;
  filename: string;
  purchase_date: string;
  total_rows: number;
  new_rows: number;
  existing_rows: number;
  duplicate_rows: number;
  invalid_rows: number;
  missing_apn_rows: number;
  committed_rows: number;
  failed_rows: number;
  status: 'processing' | 'completed' | 'completed_with_errors' | 'failed';
  error_summary: string | null;
  has_source_file: boolean;
}

export interface ImportCounts {
  total: number;
  newRows: number;
  existing: number;
  duplicate: number;
  invalid: number;
  missingApn: number;
}

export interface CommitResult {
  batchId: string;
  committed: number;
  failed: number;
  firstError: string | null;
  phonesLinked: number;
  dncNumbers: number;
  phoneError: string | null;
}

const COMMIT_CHUNK_SIZE = 500;
const SOURCE_FILES_MAX_CHARS = 4_000_000; // raw CSV text kept with a batch, above this it is not stored
const COMMIT_CONCURRENCY = 2; // 500-row inserts in flight at once; 4 at once timed out on large imports
const COMMIT_RETRIES = 4; // retries of a batch that hits a timeout or a dropped connection, with a longer wait each time

// Links each property to its phone numbers. A number is stored once. A DNC flag turns on, and never off.
// DNC numbers get a 'dnc' suppression, so exports can leave them out.
async function savePhones(
  client: SupabaseClient,
  phones: Map<string, PhoneLink[]>,
  propertyIds: Map<string, string>,
  batchId: string,
): Promise<{ linked: number; dnc: number }> {
  const numbers = new Map<string, { lineType: string | null; dnc: boolean; dncFederal: boolean }>();
  for (const list of phones.values()) {
    for (const p of list) {
      const current = numbers.get(p.phone) ?? { lineType: p.lineType, dnc: false, dncFederal: false };
      current.lineType = current.lineType ?? p.lineType;
      current.dnc = current.dnc || p.dnc;
      current.dncFederal = current.dncFederal || p.dncFederal;
      numbers.set(p.phone, current);
    }
  }
  const phoneList = [...numbers.keys()];

  for (const part of chunk(phoneList, COMMIT_CHUNK_SIZE)) {
    const { error } = await client
      .from('phone_numbers')
      .upsert(part.map((ph) => ({ phone_number: ph, line_type: numbers.get(ph)?.lineType ?? null })), {
        onConflict: 'phone_number',
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`Phone numbers could not be saved: ${error.message}`);
  }

  const dncNow = phoneList.filter((ph) => numbers.get(ph)?.dnc);
  for (const part of chunk(dncNow, COMMIT_CHUNK_SIZE)) {
    const { error } = await client.from('phone_numbers').update({ dnc: true }).in('phone_number', part);
    if (error) throw new Error(`Do Not Call flags could not be saved: ${error.message}`);
  }
  const federal = phoneList.filter((ph) => numbers.get(ph)?.dncFederal);
  for (const part of chunk(federal, COMMIT_CHUNK_SIZE)) {
    const { error } = await client.from('phone_numbers').update({ dnc_federal: true }).in('phone_number', part);
    if (error) throw new Error(`Federal Do Not Call flags could not be saved: ${error.message}`);
  }

  const idByPhone = new Map<string, string>();
  for (const part of chunk(phoneList, COMMIT_CHUNK_SIZE)) {
    const { data, error } = await client.from('phone_numbers').select('id,phone_number').in('phone_number', part);
    if (error) throw new Error(`Phone numbers could not be read back: ${error.message}`);
    for (const row of data ?? []) idByPhone.set(row.phone_number as string, row.id as string);
  }

  const links: { property_id: string; phone_number_id: string; position: number; import_batch_id: string }[] = [];
  for (const [internalId, list] of phones) {
    const propertyId = propertyIds.get(internalId);
    if (!propertyId) continue;
    for (const p of list) {
      const phoneId = idByPhone.get(p.phone);
      if (phoneId) links.push({ property_id: propertyId, phone_number_id: phoneId, position: p.position, import_batch_id: batchId });
    }
  }
  for (const part of chunk(links, COMMIT_CHUNK_SIZE)) {
    const { error } = await client.from('property_phones').upsert(part, { onConflict: 'property_id,phone_number_id', ignoreDuplicates: true });
    if (error) throw new Error(`Phone links could not be saved: ${error.message}`);
  }

  const suppressions = dncNow
    .map((ph) => idByPhone.get(ph))
    .filter((id): id is string => !!id)
    .map((id) => ({ phone_number_id: id, suppression_type: 'dnc', source: 'import' }));
  for (const part of chunk(suppressions, COMMIT_CHUNK_SIZE)) {
    const { error } = await client.from('phone_suppressions').upsert(part, { onConflict: 'phone_number_id,suppression_type', ignoreDuplicates: true });
    if (error) throw new Error(`Do Not Call suppressions could not be saved: ${error.message}`);
  }

  return { linked: links.length, dnc: dncNow.length };
}

// Saves the new rows of one import, then their phone numbers. The batch row is created first, so every saved
// property can point to it. Property rows are written in chunks; a failed chunk is counted and reported.
// A phone error is reported separately and does not undo the properties already saved.
export async function commitImport(args: {
  filename: string;
  purchaseDate: string;
  counts: ImportCounts;
  buildRows: (batchId: string) => PropertyInsert[];
  phones?: Map<string, PhoneLink[]>;
  sourceFiles?: { name: string; csv: string }[];
  onProgress?: (done: number, total: number) => void;
}): Promise<CommitResult> {
  if (!supabase) throw new Error('The database is not connected, so the import cannot be saved.');
  const client = supabase;

  const sourceChars = (args.sourceFiles ?? []).reduce((sum, f) => sum + f.csv.length, 0);
  const keepSourceFiles = sourceChars > 0 && sourceChars <= SOURCE_FILES_MAX_CHARS;

  const created = await client
    .from('import_batches')
    .insert({
      filename: args.filename,
      source: 'land_portal',
      purchase_date: args.purchaseDate,
      total_rows: args.counts.total,
      new_rows: args.counts.newRows,
      existing_rows: args.counts.existing,
      duplicate_rows: args.counts.duplicate,
      invalid_rows: args.counts.invalid,
      missing_apn_rows: args.counts.missingApn,
      status: 'processing',
      // The raw CSV text is kept only for modest batches. Large ones would make this one insert time out.
      has_source_file: keepSourceFiles,
      source_files: keepSourceFiles ? args.sourceFiles : null,
    })
    .select('id')
    .single();
  if (created.error || !created.data) {
    throw new Error(`The import could not be started: ${created.error?.message ?? 'no batch id returned'}`);
  }
  const batchId = created.data.id as string;

  const rows = args.buildRows(batchId);
  let committed = 0;
  let failed = 0;
  let firstError: string | null = null;
  const propertyIds = new Map<string, string>();
  // Batches of 500 rows, several in flight at once. A batch that fails on a timeout or a dropped connection is retried;
  // a batch that still fails is counted as failed and the rest carry on.
  const pieces = chunk(rows, COMMIT_CHUNK_SIZE);
  await runQueue(pieces, COMMIT_CONCURRENCY, async (piece) => {
    const { data, error } = await withRetry(
      () => client.from('properties').insert(piece).select('id,internal_id'),
      COMMIT_RETRIES,
    );
    if (error) {
      failed += piece.length;
      firstError ??= error.message;
    } else {
      committed += piece.length;
      for (const row of data ?? []) propertyIds.set(row.internal_id as string, row.id as string);
    }
    args.onProgress?.(Math.min(committed + failed, rows.length), rows.length);
  });

  let phonesLinked = 0;
  let dncNumbers = 0;
  let phoneError: string | null = null;
  if (args.phones && args.phones.size > 0 && propertyIds.size > 0) {
    try {
      const result = await savePhones(client, args.phones, propertyIds, batchId);
      phonesLinked = result.linked;
      dncNumbers = result.dnc;
    } catch (error) {
      phoneError = error instanceof Error ? error.message : 'Phone numbers could not be saved.';
    }
  }

  // Line the new properties up with the conversations already in the system: link conversations by phone and owner,
  // then mark the responders. A failure here does not undo the import; the next sync cycle repeats both steps.
  let alignError: string | null = null;
  if (committed > 0) {
    const matched = await client.rpc('sc_match_conversations');
    const marked = matched.error ? matched : await client.rpc('sc_mark_responders');
    if (matched.error || marked.error) alignError = (matched.error ?? marked.error)?.message ?? 'Matching failed.';
  }

  const status: ImportBatchRecord['status'] =
    failed === 0 ? 'completed' : committed === 0 ? 'failed' : 'completed_with_errors';

  const finished = await client
    .from('import_batches')
    .update({
      committed_rows: committed,
      failed_rows: failed,
      status,
      error_summary: firstError ?? phoneError ?? alignError,
    })
    .eq('id', batchId);
  if (finished.error) {
    throw new Error(`Rows were saved, but the batch status could not be updated: ${finished.error.message}`);
  }

  return { batchId, committed, failed, firstError, phonesLinked, dncNumbers, phoneError };
}

export async function listImportBatches(limit = 50): Promise<ImportBatchRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('import_batches')
    .select(
      'id,created_at,filename,purchase_date,total_rows,new_rows,existing_rows,duplicate_rows,invalid_rows,missing_apn_rows,committed_rows,failed_rows,status,error_summary,has_source_file',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load import history: ${error.message}`);
  return (data ?? []) as ImportBatchRecord[];
}

export interface MergeResult {
  history_id: string;
  kept_property_id: string;
  removed_property_id: string;
  owners_moved: number;
  identifiers_moved: number;
  phones_moved: number;
  dataset_records_moved: number;
  marketing_rows_moved: number;
}

// Merges a duplicate into the property being kept (merge_properties in supabase/migrations/015_merge_properties.sql).
// The whole merge runs in one transaction; the removed property's full record is saved in property_merge_history first.
export async function mergeProperties(args: { keepId: string; removeId: string; notes: string }): Promise<MergeResult> {
  if (!supabase) throw new Error('The database is not connected, so the properties cannot be merged.');
  const { data, error } = await supabase.rpc('merge_properties', {
    p_source: args.removeId,
    p_target: args.keepId,
    p_notes: args.notes.trim() || null,
  });
  if (error) throw new Error(`The properties could not be merged: ${error.message}`);
  return data as MergeResult;
}

export type HistoryRowInput = import('@/lib/smartercontactHistory').HistoryRow;

export interface SmarterContactReviewRow {
  row: number;
  apn: string;
  owner: string;
  reason: string;
}

export interface SmarterContactHistoryResult {
  applied: boolean;
  run_id: string | null;
  rows_total: number;
  rows_matched: number;
  rows_review: number;
  contacts_linked: number;
  phones_linked: number;
  campaigns: number;
  review: SmarterContactReviewRow[];
}

// Matches a SmarterContact campaign export to properties. apply = false only previews; apply = true saves
// (smartercontact_import in supabase/migrations/016_smartercontact_history.sql).
export async function runSmarterContactHistory(args: {
  filename: string;
  rows: HistoryRowInput[];
  apply: boolean;
}): Promise<SmarterContactHistoryResult> {
  if (!supabase) throw new Error('The database is not connected, so the history cannot be checked.');
  const { data, error } = await supabase.rpc('smartercontact_import', {
    p_filename: args.filename,
    p_rows: args.rows,
    p_apply: args.apply,
  });
  if (error) throw new Error(`The SmarterContact history could not be ${args.apply ? 'saved' : 'checked'}: ${error.message}`);
  return data as SmarterContactHistoryResult;
}

export interface SmarterContactRun {
  id: string;
  created_at: string;
  filename: string;
  rows_total: number;
  rows_matched: number;
  rows_review: number;
  contacts_linked: number;
  phones_linked: number;
  campaigns_touched: number;
}

// Saved SmarterContact campaign-history runs, newest first (smartercontact_import_runs, migration 016).
export async function listSmarterContactRuns(limit = 50): Promise<SmarterContactRun[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('smartercontact_import_runs')
    .select('id,created_at,filename,rows_total,rows_matched,rows_review,contacts_linked,phones_linked,campaigns_touched')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load SmarterContact history runs: ${error.message}`);
  return (data ?? []) as SmarterContactRun[];
}

// The uploaded files saved with an import batch, as they were read (name and CSV text).
export async function getImportBatchFiles(batchId: string): Promise<{ name: string; csv: string }[]> {
  if (!supabase) throw new Error('The database is not connected.');
  const { data, error } = await supabase.from('import_batches').select('source_files').eq('id', batchId).single();
  if (error) throw new Error(`The file could not be loaded: ${error.message}`);
  const files = (data?.source_files ?? []) as { name: string; csv: string }[];
  if (files.length === 0) throw new Error('No file was saved for this import.');
  return files;
}

// Removes an import: its properties (owners and phone links go with them), then the batch record.
// Phone numbers that were saved for these properties stay in the phone table.
// Runs discard_import_batch (supabase/migrations/017_discard_import_batch.sql). A direct delete does nothing
// for signed-in users because the tables have no delete policy, so the removal runs inside the database.
export async function discardImportBatch(batchId: string): Promise<{ properties: number }> {
  if (!supabase) throw new Error('The database is not connected.');
  const { data, error } = await supabase.rpc('discard_import_batch', { p_batch: batchId });
  if (error) throw new Error(`The import could not be discarded: ${error.message}`);
  const result = data as { properties_removed: number; batches_removed: number };
  if (result.batches_removed !== 1) throw new Error('The import was not removed. Check that your account can discard imports.');
  return { properties: result.properties_removed };
}

export interface DashboardSummary {
  total: number;
  never_marketed: number;
  contacted: number;
  followup_due: number;
  rehit_due: number;
  wrong_number: number;
  opted_out: number;
  responded: number;
  reached_1: number;
  reached_2: number;
  reached_3: number;
  counties: { state: string; county: string; records: number; texted: number }[];
}

// Overview figures, counted in the database (dashboard_summary in supabase/migrations/010_dashboard_summary.sql).
// Never marketed vs previously marketed, from the full outbound message history (migration 037).
export async function getMarketingSplit(): Promise<{ never_marketed: number; previously_marketed: number; conversations_read_in_full: number; conversations_total: number }> {
  const empty = { never_marketed: 0, previously_marketed: 0, conversations_read_in_full: 0, conversations_total: 0 };
  if (!supabase) return empty;
  const { data, error } = await supabase.rpc('sc_marketing_split');
  if (error) throw new Error(`Could not load the marketing history: ${error.message}`);
  const row = (data ?? {}) as Record<string, number>;
  return {
    never_marketed: row.never_marketed ?? 0,
    previously_marketed: row.previously_marketed ?? 0,
    conversations_read_in_full: row.conversations_read_in_full ?? 0,
    conversations_total: row.conversations_total ?? 0,
  };
}

// Lead groups from the SmarterContact labels of linked conversations (migration 035). Each property is counted once.
export async function getLeadGroups(): Promise<{ nurture: number; scheduled_followup: number; excluded: number; linked_properties: number }> {
  if (!supabase) return { nurture: 0, scheduled_followup: 0, excluded: 0, linked_properties: 0 };
  const { data, error } = await supabase.rpc('sc_lead_groups');
  if (error) throw new Error(`Could not load the lead groups: ${error.message}`);
  const row = (data ?? {}) as Record<string, number>;
  return {
    nurture: row.nurture ?? 0,
    scheduled_followup: row.scheduled_followup ?? 0,
    excluded: row.excluded ?? 0,
    linked_properties: row.linked_properties ?? 0,
  };
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  if (!supabase) {
    return {
      total: 0, never_marketed: 0, contacted: 0, followup_due: 0, rehit_due: 0, wrong_number: 0, opted_out: 0,
      responded: 0, reached_1: 0, reached_2: 0, reached_3: 0, counties: [],
    };
  }
  const { data, error } = await supabase.rpc('dashboard_summary');
  if (error) throw new Error(`Could not load the dashboard: ${error.message}`);
  const raw = (data ?? {}) as Record<string, unknown>;
  const num = (key: string) => Number(raw[key] ?? 0);
  const counties = (raw.counties ?? []) as { state: string; county: string; records: number | string; texted: number | string }[];
  return {
    total: num('total'),
    never_marketed: num('never_marketed'),
    contacted: num('contacted'),
    followup_due: num('followup_due'),
    rehit_due: num('rehit_due'),
    wrong_number: num('wrong_number'),
    opted_out: num('opted_out'),
    responded: num('responded'),
    reached_1: num('reached_1'),
    reached_2: num('reached_2'),
    reached_3: num('reached_3'),
    counties: counties.map((c) => ({ state: c.state, county: c.county, records: Number(c.records), texted: Number(c.texted) })),
  };
}

export interface SavedFilterRecord {
  id: string;
  name: string;
  criteria: Record<string, unknown>;
  created_by: string;
  created_at: string;
}

// Team filter sets, newest first (saved_filters in supabase/migrations/011_saved_filters.sql).
export async function listSavedFilters(): Promise<SavedFilterRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('saved_filters')
    .select('id,name,criteria,created_by,created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not load saved filters: ${error.message}`);
  return (data ?? []) as SavedFilterRecord[];
}

// Saves a filter under a name. The database rejects a name that is already used, ignoring case.
export async function saveFilter(name: string, criteria: Record<string, unknown>): Promise<void> {
  if (!supabase) throw new Error('The database is not connected, so the filter was not saved.');
  const { error } = await supabase.from('saved_filters').insert({ name: name.trim(), criteria });
  if (error) {
    const duplicate = /duplicate key|saved_filters_name/i.test(error.message);
    throw new Error(duplicate ? 'A saved filter with this name already exists.' : `The filter could not be saved: ${error.message}`);
  }
}

export async function deleteSavedFilter(id: string): Promise<void> {
  if (!supabase) throw new Error('The database is not connected.');
  const { error } = await supabase.from('saved_filters').delete().eq('id', id);
  if (error) throw new Error(`The filter could not be deleted: ${error.message}`);
}

// Recent activity, built from the records each screen already writes: property imports, exclusion exports,
// SmarterContact history imports and campaigns. The newest five are shown.
export async function getActivity(): Promise<DataResult<ActivityEvent[]>> {
  const client = supabase;
  if (!client) return wrap([], 'none');
  const recent = (table: string, columns: string) =>
    client.from(table).select(columns).order('created_at', { ascending: false }).limit(5);
  const [imports, exports, history, campaigns, people] = await Promise.all([
    recent('import_batches', 'id,created_at,created_by,filename,new_rows'),
    recent('exclusion_exports', 'id,created_at,created_by,filename,parcel_count'),
    recent('smartercontact_import_runs', 'id,created_at,created_by,filename,contacts_linked'),
    recent('campaigns', 'id,created_at,created_by,name'),
    client.from('profiles').select('id,full_name,email'),
  ]);
  for (const result of [imports, exports, history, campaigns, people]) {
    if (result.error) throw new Error(`Could not load recent activity: ${result.error.message}`);
  }

  const who = new Map<string, string>(
    ((people.data ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, p.full_name || p.email]),
  );
  const name = (id: unknown) => (typeof id === 'string' ? (who.get(id) ?? 'Someone') : 'Someone');

  const events: ActivityEvent[] = [
    ...((imports.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: `import:${r.id}`,
      user: name(r.created_by),
      action: `Imported ${r.filename} (${Number(r.new_rows ?? 0).toLocaleString('en-US')} new properties)`,
      at: r.created_at as string,
    })),
    ...((exports.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: `export:${r.id}`,
      user: name(r.created_by),
      action: `Exported ${r.filename} (${Number(r.parcel_count ?? 0).toLocaleString('en-US')} parcels)`,
      at: r.created_at as string,
    })),
    ...((history.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: `history:${r.id}`,
      user: name(r.created_by),
      action: `SmarterContact history ${r.filename} (${Number(r.contacts_linked ?? 0).toLocaleString('en-US')} contacts linked)`,
      at: r.created_at as string,
    })),
    ...((campaigns.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: `campaign:${r.id}`,
      user: name(r.created_by),
      action: `Created campaign ${r.name}`,
      at: r.created_at as string,
    })),
  ];
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { data: events.slice(0, 5), source: 'supabase', fetchedAt: new Date().toISOString() };
}

// ---------- conversation notes (migration 041) ----------

export interface ConversationNote {
  id: string;
  body: string;
  authorId: string | null;
  createdAt: string;
}

// The notes on one SmarterContact conversation, newest first.
export async function listConversationNotes(contactId: string): Promise<ConversationNote[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('conversation_notes')
    .select('id,body,author_id,created_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load the notes: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    body: row.body as string,
    authorId: (row.author_id as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

export async function addConversationNote(contactId: string, body: string): Promise<void> {
  if (!supabase) throw new Error('The database is not connected, so the note cannot be saved.');
  const text = body.trim();
  if (text.length === 0 || text.length > 4000) throw new Error('A note must be between 1 and 4000 characters.');
  const { error } = await supabase.from('conversation_notes').insert({ contact_id: contactId, body: text });
  if (error) throw new Error(`The note could not be saved: ${error.message}`);
}

// ---------- property facts shown beside a conversation ----------

export interface PropertyFacts {
  id: string;
  apn: string;
  county: string;
  state: string;
  acres: number;
  ownerName: string;
  ownerType: string | null;
  propertyAddress: string;
  propertyCity: string;
  propertyZip: string;
  mailingAddress: string;
  mailingCity: string;
  mailingState: string;
  mailingZip: string;
  latitude: number | null;
  longitude: number | null;
  landUse: string;
  zoning: string;
  assessedValue: number | null;
  marketValue: number | null;
  yearBuilt: number | null;
  marketingStatus: string;
  firstAcquiredAt: string | null;
}

export async function getPropertyFacts(id: string): Promise<PropertyFacts | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('properties')
    .select(
      'id,apn_raw,county,state,acreage,owner_name,owner_type,address,city,zip_code,mailing_address,mailing_city,mailing_state,mailing_zip,latitude,longitude,land_use,zoning,assessed_value,market_value,year_built,marketing_status,first_acquired_at,created_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the property: ${error.message}`);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const text = (key: string) => (row[key] as string | null) ?? '';
  const num = (key: string) => (row[key] === null || row[key] === undefined ? null : Number(row[key]));
  return {
    id: row.id as string,
    apn: text('apn_raw'),
    county: text('county'),
    state: text('state'),
    acres: Number(row.acreage ?? 0),
    ownerName: text('owner_name'),
    ownerType: (row.owner_type as string | null) ?? null,
    propertyAddress: text('address'),
    propertyCity: text('city'),
    propertyZip: text('zip_code'),
    mailingAddress: text('mailing_address'),
    mailingCity: text('mailing_city'),
    mailingState: text('mailing_state'),
    mailingZip: text('mailing_zip'),
    latitude: num('latitude'),
    longitude: num('longitude'),
    landUse: text('land_use'),
    zoning: text('zoning'),
    assessedValue: num('assessed_value'),
    marketValue: num('market_value'),
    yearBuilt: num('year_built'),
    marketingStatus: text('marketing_status'),
    firstAcquiredAt: (row.first_acquired_at as string | null) ?? (row.created_at as string | null),
  };
}

// The NextCrest-only contact fields of one conversation (migration 043), as saved values keyed by field key.
export async function getConversationFields(contactId: string): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data, error } = await supabase.from('conversation_fields').select('data').eq('contact_id', contactId).maybeSingle();
  if (error) throw new Error(`Could not load the contact fields: ${error.message}`);
  return (data?.data ?? {}) as Record<string, string>;
}

// Saves changed NextCrest-only fields, keeping the other saved values.
export async function saveConversationFields(contactId: string, changed: Record<string, string>): Promise<void> {
  if (!supabase) throw new Error('The database is not connected, so the fields cannot be saved.');
  const current = await getConversationFields(contactId);
  const merged = { ...current, ...changed };
  const { error } = await supabase
    .from('conversation_fields')
    .upsert({ contact_id: contactId, data: merged, updated_at: new Date().toISOString() }, { onConflict: 'contact_id' });
  if (error) throw new Error(`The fields could not be saved: ${error.message}`);
}

export interface OwnerProperty {
  id: string;
  apn: string;
  county: string;
  state: string;
  acres: number;
  marketingStatus: string;
  timesContacted: number;
  lastContactedAt: string | null;
}

// The other properties of the same owner name (owner_name_key, migration 044), not including this one.
export async function getOwnerProperties(propertyId: string): Promise<OwnerProperty[]> {
  if (!supabase) return [];
  const { data: self, error: selfError } = await supabase.from('properties').select('owner_name_key').eq('id', propertyId).maybeSingle();
  if (selfError) throw new Error(`Could not load the owner: ${selfError.message}`);
  const key = self?.owner_name_key as string | null | undefined;
  if (!key) return [];
  const { data, error } = await supabase
    .from('properties')
    .select('id,apn_raw,internal_id,county,state,acreage,marketing_status,total_contacts,last_contacted_at')
    .eq('owner_name_key', key)
    .neq('id', propertyId)
    .order('apn_raw')
    .limit(50);
  if (error) throw new Error(`Could not load the owner's properties: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    apn: (row.apn_raw as string | null) ?? (row.internal_id as string),
    county: (row.county as string | null) ?? '',
    state: (row.state as string | null) ?? '',
    acres: Number(row.acreage ?? 0),
    marketingStatus: (row.marketing_status as string | null) ?? '',
    timesContacted: Number(row.total_contacts ?? 0),
    lastContactedAt: (row.last_contacted_at as string | null) ?? null,
  }));
}

// Adds a phone number to NextCrest's Do Not Call list. Exports leave it out. This does not change SmarterContact's own list,
// which its API does not allow.
export async function addPhoneToDoNotCall(phone: string): Promise<void> {
  if (!supabase) throw new Error('The database is not connected, so the number cannot be added.');
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) throw new Error('This conversation has no 10-digit phone number to add.');
  const { error: upsertError } = await supabase
    .from('phone_numbers')
    .upsert({ phone_number: digits, dnc: true }, { onConflict: 'phone_number' });
  if (upsertError) throw new Error(`The number could not be saved: ${upsertError.message}`);
  const { data, error: readError } = await supabase.from('phone_numbers').select('id').eq('phone_number', digits).single();
  if (readError || !data) throw new Error(`The number could not be read back: ${readError?.message ?? 'not found'}`);
  const { error } = await supabase
    .from('phone_suppressions')
    .upsert({ phone_number_id: data.id, suppression_type: 'dnc', source: 'inbox' }, { onConflict: 'phone_number_id,suppression_type', ignoreDuplicates: true });
  if (error) throw new Error(`The Do Not Call entry could not be saved: ${error.message}`);
}
