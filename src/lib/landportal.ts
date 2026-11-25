// Client for the Land Portal V2 API (https://api.landportal.com/v2). Calls go to the development proxy in
// vite.config.ts, which attaches the API key. Nothing here handles the key itself.
//
// The screens keep their existing shapes. This module converts the V2 responses into them, so the rest of the app
// does not change when the API does.

const PROXY_BASE = '/api/landportal';
const MAX_FILTER_ROWS = 5000;
const FILTER_PAGE_SIZE = 100;

export class LandPortalError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'LandPortalError';
    this.status = status;
    this.body = body;
  }
}

export interface LandPortalMeta {
  requests_left?: number;
  rows_left?: number;
  rejected_filters?: Array<{ key: string; value: unknown; reason: string }>;
  message?: string;
  [extra: string]: unknown;
}

export interface LandPortalResult<T> {
  data: T;
  meta: LandPortalMeta;
  message?: string;
}

interface Envelope<T> {
  data?: T;
  message?: string;
  meta?: LandPortalMeta;
  error?: { message?: string };
}

// Reads a response body as JSON. Anything else (for example an HTML error page) gives null.
function parseEnvelope<T>(text: string): Envelope<T> | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Envelope<T>;
  } catch {
    return null;
  }
}

// The V2 envelope is { data, message, meta }. Errors carry { error: { code, message } } and a top-level message.
async function call<T>(
  endpoint: string,
  init: { method?: 'GET' | 'POST'; query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<LandPortalResult<T>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.size > 0 ? `?${params.toString()}` : '';

  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}${endpoint}${query}`, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new LandPortalError('Could not reach the Land Portal proxy', 0, null);
  }

  const json = parseEnvelope<T>(await response.text());

  if (!response.ok || !json || json.data === undefined) {
    const message = json?.error?.message ?? json?.message ?? `Land Portal request failed (HTTP ${response.status})`;
    throw new LandPortalError(message, response.status, json);
  }
  return { data: json.data, meta: json.meta ?? {}, message: json.message };
}

// ---------------------------------------------------------------------------
// Filter data
// ---------------------------------------------------------------------------

export interface LandPortalFilterDefinition {
  key: string;
  label: string;
  type: string;
  example: unknown;
}

// GET /filter-data/filters (no quota). Lists every filter key and whether its values can be looked up.
export async function getFilterList(): Promise<LandPortalResult<LandPortalFilterDefinition[]>> {
  const result = await call<{ filters: LandPortalFilterDefinition[] | null }>('/filter-data/filters');
  return { ...result, data: result.data.filters ?? [] };
}

interface FilterValuesData {
  key: string;
  type: 'county' | 'dictionary';
  values: Record<string, string>;
}

// GET /filter-data/filters/{key}/values (no quota).
// Returns { [key]: values }. County-backed values (cities, ZIP codes) are a sorted list of names. Dictionary values
// (land-use codes, vacancy sources, counties by FIPS) are a flat map of code to label, as the API sends them.
export async function getFilterValues(filter: string, fips?: string) {
  const result = await call<FilterValuesData>(`/filter-data/filters/${encodeURIComponent(filter)}/values`, {
    query: fips ? { fips } : undefined,
  });
  const values = result.data.values ?? {};
  const shaped = result.data.type === 'county' ? Object.keys(values).sort() : values;
  return { ...result, data: { [filter]: shaped } as Record<string, unknown> };
}

export interface LandPortalFilterRequest {
  filters: Record<string, unknown>;
  duplicates?: boolean;
  empty_mailing_addresses?: boolean;
}

// The app's filters are keyed by field name, with the counties under "fips". V2 takes a list of filter objects,
// and the counties go in their own field.
export function splitFilters(filters: Record<string, unknown>): { fips: string[]; list: Array<Record<string, unknown>> } {
  const { fips: fipsFilter, ...rest } = filters;
  const fipsValue = (fipsFilter as { value?: unknown } | undefined)?.value;
  const fips = Array.isArray(fipsValue) ? fipsValue.map(String) : typeof fipsValue === 'string' ? [fipsValue] : [];
  const list = Object.entries(rest).map(([key, filter]) => ({ key, ...(filter as Record<string, unknown>) }));
  return { fips, list };
}

// The V2 row names, mapped back to the names the Search & Buy screen reads.
export function toLegacyRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    propertyid: row.property_id,
    fips: row.fips,
    apn: row.apn,
    ownername1full: row.owner_full_name,
    situsfullstreetaddress: row.street_address,
    lotsizeacres: row.lot_size_acres,
  };
}

// POST /filter-data, following page_token until every match is read (capped at MAX_FILTER_ROWS).
// count is the total number of matches, from the first page.
export async function filterProperties(request: LandPortalFilterRequest) {
  const { fips, list } = splitFilters(request.filters);
  const body: Record<string, unknown> = { fips, filters: list };
  if (request.duplicates !== undefined) body.duplicates = request.duplicates;
  if (request.empty_mailing_addresses !== undefined) body.empty_mailing_addresses = request.empty_mailing_addresses;

  const rows: Array<Record<string, unknown>> = [];
  let count = 0;
  let meta: LandPortalMeta = {};
  let message: string | undefined;
  let pageToken: string | undefined;
  do {
    const page = await call<{ count: number; properties: Array<Record<string, unknown>> | null; next_page_token?: string }>(
      '/filter-data',
      { method: 'POST', body, query: { page_size: FILTER_PAGE_SIZE, page_token: pageToken } },
    );
    if (pageToken === undefined) {
      count = page.data.count;
      meta = page.meta;
      message = page.message;
    }
    rows.push(...(page.data.properties ?? []).map(toLegacyRow));
    pageToken = page.data.next_page_token || undefined;
  } while (pageToken && rows.length < MAX_FILTER_ROWS);

  return { data: { count, properties: rows }, meta, message };
}

// ---------------------------------------------------------------------------
// Export tasks (CSV). Charges one export row per property. Spends export rows.
// ---------------------------------------------------------------------------

export type ExportTaskStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'stopped';

// The app's export status: task_id is the V2 export_id, file_url is the temporary CSV download link.
export interface LandPortalExportStatus {
  task_id: string;
  status: ExportTaskStatus;
  file_url?: string;
  rows?: number;
  error_message?: string;
}

interface ExportTaskData {
  export_id: string;
  status: ExportTaskStatus;
  download_url?: string;
  rows?: number;
  total_rows?: number;
  error_message?: string;
}

function toExportStatus(data: ExportTaskData): LandPortalExportStatus {
  return {
    task_id: data.export_id,
    status: data.status,
    file_url: data.download_url || undefined,
    rows: data.rows ?? data.total_rows,
    error_message: data.error_message || undefined,
  };
}

// Converts property IDs to integers and drops duplicates. Throws when an ID is not a whole number.
export function propertyIdsAsIntegers(ids: Array<string | number>): number[] {
  const out = new Set<number>();
  for (const id of ids) {
    const value = typeof id === 'number' ? id : Number(String(id).trim());
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new LandPortalError(`Property ID "${id}" is not a whole number.`, 0, null);
    }
    out.add(value);
  }
  return [...out];
}

// POST /exports. The row balance is charged when the task is created (meta.rows_left is what remains).
export async function createExport(_fips: Array<string | number>, propertyid: Array<string | number>) {
  const result = await call<ExportTaskData>('/exports', {
    method: 'POST',
    // V2 takes property IDs as whole numbers. Values that are not whole numbers are rejected here, before the request.
    body: { export_type: 'property_csv', property_ids: propertyIdsAsIntegers(propertyid) },
  });
  return {
    ...result,
    data: { task_id: result.data.export_id, export_tokens_left: result.meta.rows_left ?? 0, message: result.message ?? '' },
  };
}

// GET /exports/{export_id}
export async function getExportStatus(taskId: string) {
  const result = await call<ExportTaskData>(`/exports/${encodeURIComponent(taskId)}`);
  return { ...result, data: toExportStatus(result.data) };
}

// ---------------------------------------------------------------------------
// Mapping into NextCrest property fields
// ---------------------------------------------------------------------------

// Fields from a Land Portal property (legacy names) that map onto the app's Property record.
export interface LandPortalProperty {
  propertyid: number;
  apn?: string;
  situsfullstreetaddress?: string;
  situscity?: string;
  situszip5?: string;
  situsstate?: string;
  situscounty?: string;
  legaldescription?: string;
  ownername1full?: string;
  owner1firstname?: string;
  owner1lastname?: string;
  mailingfullstreetaddress?: string;
  [extraField: string]: unknown;
}

// Fields from a Land Portal property that map onto the app's Property record.
// Fields the API did not return are left out, not set to null.
export interface LandPortalPropertyFields {
  source: 'land_portal';
  originalSourceId: string;
  state?: string;
  county?: string;
  city?: string;
  zipCode?: string;
  address?: string;
  legalDescription?: string;
  ownerName?: string;
  mailingAddress?: string;
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function toPropertyFields(property: LandPortalProperty): LandPortalPropertyFields {
  const splitName = [clean(property.owner1firstname), clean(property.owner1lastname)].filter(Boolean).join(' ');
  const owner = clean(property.ownername1full) ?? (splitName || undefined);

  const fields: LandPortalPropertyFields = {
    source: 'land_portal',
    originalSourceId: String(property.propertyid),
    state: clean(property.situsstate),
    county: clean(property.situscounty),
    city: clean(property.situscity),
    zipCode: clean(property.situszip5),
    address: clean(property.situsfullstreetaddress),
    legalDescription: clean(property.legaldescription),
    ownerName: owner,
    mailingAddress: clean(property.mailingfullstreetaddress),
  };

  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as LandPortalPropertyFields;
}
