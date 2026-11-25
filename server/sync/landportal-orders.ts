// Land Portal order history sync (V2 API). Loads the account's exports, skip traces and comp reports into
// landportal_order_history (migration 025).
//
//   npm run sync:landportal-orders
//
// Environment (from .env): LANDPORT_V2_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
// Read-only: the code only sends GET requests to the Land Portal V2 API. Download links and tokens in the
// responses are dropped before anything is saved.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const API_BASE = 'https://api.landportal.com/v2';
const PAGE_SIZE = 100;
const PAUSE_MS = 500; // stays well under the 60 requests per minute baseline

type OrderType = 'export' | 'skip_trace' | 'comp_report';

interface OrderRow {
  id: string;
  order_type: OrderType;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  total_rows: number | null;
  success_rows: number | null;
  no_match_rows: number | null;
  test_mode: boolean;
  details: Record<string, unknown>;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Keys that carry download links or secrets. They are never stored.
function isSensitive(key: string): boolean {
  return /url|token|secret|key|email|phone|address|name/i.test(key) && !/^(address_count|num_)/.test(key);
}

function safeDetails(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key, value]) => !isSensitive(key) && typeof value !== 'object'));
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

async function get<T>(apiKey: string, path: string, query: Record<string, string | number | undefined>): Promise<T> {
  const params = new URLSearchParams(
    Object.entries(query)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API_BASE}${path}${params.size ? `?${params}` : ''}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if ((res.status === 429 || res.status === 503) && attempt < 5) {
      const wait = Number(res.headers.get('retry-after') ?? 5) * 1000;
      await pause(wait);
      continue;
    }
    const body = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string } } | null;
    if (!res.ok || !body?.data) {
      throw new Error(`${path} failed: HTTP ${res.status} ${body?.error?.code ?? ''} ${body?.error?.message ?? ''}`.trim());
    }
    await pause(PAUSE_MS);
    return body.data;
  }
}

// Exports and comp reports use a cursor (next_page_token). Skip traces use page numbers.
async function allExports(apiKey: string): Promise<OrderRow[]> {
  const rows: OrderRow[] = [];
  let token: string | undefined;
  do {
    const data = await get<{ exports: Record<string, unknown>[]; next_page_token?: string }>(apiKey, '/exports', {
      page_size: PAGE_SIZE,
      page_token: token,
    });
    for (const item of data.exports ?? []) {
      const id = String(item.export_id ?? item.id ?? '');
      if (!id) continue;
      rows.push({
        id: `export:${id}`,
        order_type: 'export',
        status: str(item.status),
        created_at: str(item.created_at),
        updated_at: str(item.updated_at),
        total_rows: num(item.total_rows) ?? num(item.rows),
        success_rows: null,
        no_match_rows: null,
        test_mode: item.test_mode === true,
        details: safeDetails(item),
      });
    }
    token = data.next_page_token || undefined;
  } while (token);
  return rows;
}

async function allSkipTraces(apiKey: string): Promise<OrderRow[]> {
  const rows: OrderRow[] = [];
  for (let page = 1; ; page++) {
    const data = await get<{ skip_traces: Record<string, unknown>[]; pages?: number }>(apiKey, '/skip-traces', {
      page,
      page_size: PAGE_SIZE,
    });
    for (const item of data.skip_traces ?? []) {
      const id = String(item.skip_trace_id ?? '');
      if (!id) continue;
      rows.push({
        id: `skip_trace:${id}`,
        order_type: 'skip_trace',
        status: str(item.status),
        created_at: str(item.created_at),
        updated_at: str(item.updated_at),
        total_rows: num(item.total_rows),
        success_rows: num(item.success_rows),
        no_match_rows: num(item.no_match_rows),
        test_mode: item.test_mode === true,
        details: safeDetails(item),
      });
    }
    if (!data.skip_traces?.length || (data.pages !== undefined && page >= data.pages)) break;
  }
  return rows;
}

async function allCompReports(apiKey: string): Promise<OrderRow[]> {
  const rows: OrderRow[] = [];
  let token: string | undefined;
  do {
    const data = await get<{ reports: Record<string, unknown>[]; next_page_token?: string }>(apiKey, '/reports/comps', {
      page_size: 50,
      page_token: token,
    });
    for (const item of data.reports ?? []) {
      const id = String(item.report_id ?? item.id ?? '');
      if (!id) continue;
      rows.push({
        id: `comp_report:${id}`,
        order_type: 'comp_report',
        status: str(item.status),
        created_at: str(item.created_at),
        updated_at: str(item.updated_at),
        total_rows: null,
        success_rows: null,
        no_match_rows: null,
        test_mode: false,
        details: safeDetails(item),
      });
    }
    token = data.next_page_token || undefined;
  } while (token);
  return rows;
}

async function save(db: SupabaseClient, rows: OrderRow[]): Promise<void> {
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500).map((r) => ({ ...r, synced_at: new Date().toISOString() }));
    const { error } = await db.from('landportal_order_history').upsert(batch, { onConflict: 'id' });
    if (error) throw new Error(`Saving the order history failed: ${error.message}`);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.LANDPORT_V2_API_KEY;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!apiKey) throw new Error('Set LANDPORT_V2_API_KEY in .env.');
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in .env.');

  const exportsRows = await allExports(apiKey);
  const skipRows = await allSkipTraces(apiKey);
  const compRows = await allCompReports(apiKey);
  const all = [...exportsRows, ...skipRows, ...compRows];

  const db = createClient(url, key, { auth: { persistSession: false } });
  await save(db, all);

  console.log('Land Portal order history saved:');
  console.log(`  Exports:        ${exportsRows.length}`);
  console.log(`  Skip traces:    ${skipRows.length}`);
  console.log(`  Comp reports:   ${compRows.length}`);
  const rowsCharged = exportsRows.reduce((sum, r) => sum + (r.total_rows ?? 0), 0);
  const skipRowsSent = skipRows.reduce((sum, r) => sum + (r.total_rows ?? 0), 0);
  console.log(`  Export rows:    ${rowsCharged.toLocaleString('en-US')}`);
  console.log(`  Skip-trace rows submitted: ${skipRowsSent.toLocaleString('en-US')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
