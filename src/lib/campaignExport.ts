import type { LandRecord } from '@/data/types';
import { formatOwnerParts, splitOwner } from './owner';

export const EXCLUSION_REASONS = [
  'Opted out',
  'Wrong number',
  'Responder (handled manually)',
  'Missing phone',
  'Duplicate phone',
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export interface ExportPlan {
  total: number;
  included: LandRecord[];
  excluded: Record<ExclusionReason, number>;
}

// Returns 10 digits, or '' when the number cannot be used for texting.
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.length === 10 ? digits : '';
}

// Suppression is applied here, once, for every export. Nothing is dropped silently:
// each exclusion is counted under a reason the caller can display.
export function planCampaignExport(records: LandRecord[]): ExportPlan {
  const excluded = Object.fromEntries(EXCLUSION_REASONS.map((reason) => [reason, 0])) as Record<ExclusionReason, number>;
  const seenPhones = new Set<string>();
  const included: LandRecord[] = [];

  for (const record of records) {
    if (record.status === 'opted_out') {
      excluded['Opted out'] += 1;
      continue;
    }
    if (record.status === 'wrong_number') {
      excluded['Wrong number'] += 1;
      continue;
    }
    if (record.responded) {
      excluded['Responder (handled manually)'] += 1;
      continue;
    }
    const phone = normalizePhone(record.phone);
    if (!phone) {
      excluded['Missing phone'] += 1;
      continue;
    }
    if (seenPhones.has(phone)) {
      excluded['Duplicate phone'] += 1;
      continue;
    }
    seenPhones.add(phone);
    included.push(record);
  }

  return { total: records.length, included, excluded };
}

export const SMARTERCONTACT_HEADERS = ['First Name', 'Last Name', 'Phone', 'APN', 'County', 'State', 'Acres'];

export function toSmarterContactRow(record: LandRecord): (string | number)[] {
  const owner = formatOwnerParts(splitOwner(record.ownerName));
  return [owner.first, owner.last, normalizePhone(record.phone), record.apn, record.county, record.state, record.acres];
}
