// Reads a SmarterContact campaign export into the rows that smartercontact_import (migration 016) matches.
// One output row per contact per export line. The Campaigns column holds several campaigns separated by "|".

import { parseCsv } from './csv';

export interface HistoryRow {
  apn: string;
  state: string;
  county: string;
  owner: string;
  phone: string;
  date_added: string | null;
  campaigns: string[];
}

export interface ParsedHistory {
  rows: HistoryRow[];
  error: string | null;
}

const REQUIRED = ['APN', 'Parcel county', 'Parcel state', 'Campaigns'];

// "7/29/2026" -> "2026-07-29". Anything that is not a valid M/D/YYYY date becomes null.
export function toIsoDate(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Campaign names from the "Campaigns" cell, trimmed, without blanks or repeats.
export function splitCampaigns(value: string): string[] {
  const names = value
    .split('|')
    .map((n) => n.trim())
    .filter(Boolean);
  return [...new Set(names)];
}

export function parseSmarterContactHistory(text: string): ParsedHistory {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], error: 'The file needs a header row and at least one contact row.' };

  const headers = table[0].map((h) => h.trim());
  const missing = REQUIRED.filter((name) => !headers.includes(name));
  if (missing.length > 0) {
    return { rows: [], error: `This is not a SmarterContact campaign export. Missing column: ${missing.join(', ')}.` };
  }

  const col = (name: string) => headers.indexOf(name);
  const phoneCol = col('Phone');
  const ownerCol = col('Owner Full Name');
  const dateCol = col('Date Added');

  const rows: HistoryRow[] = table.slice(1).map((cells) => ({
    apn: (cells[col('APN')] ?? '').trim(),
    state: (cells[col('Parcel state')] ?? '').trim(),
    county: (cells[col('Parcel county')] ?? '').trim(),
    owner: ownerCol >= 0 ? (cells[ownerCol] ?? '').trim() : '',
    phone: phoneCol >= 0 ? (cells[phoneCol] ?? '').trim() : '',
    date_added: dateCol >= 0 ? toIsoDate(cells[dateCol] ?? '') : null,
    campaigns: splitCampaigns(cells[col('Campaigns')] ?? ''),
  }));

  return { rows, error: null };
}
