import type { LandRecord, MarketingStatus, OwnerType } from '@/data/types';

// Row shape returned by the properties query in src/services/nextcrestData.ts.
export interface PropertyRow {
  id: string;
  internal_id: string;
  apn_raw: string | null;
  state: string;
  county: string | null;
  zip_code: string | null;
  acreage: string | number | null;
  owner_name: string | null;
  owner_type: string | null;
  marketing_status: string | null;
  total_contacts: number | null;
  last_contacted_at: string | null;
  first_acquired_at: string | null;
  created_at: string;
  property_owners?: Array<{ phone_numbers: string[] | null }> | null;
  // Phone numbers linked to the property (property_phones -> phone_numbers), e.g. from an import.
  property_phones?: Array<{ phone_numbers: { phone_number: string } | null }> | null;
}

// The database stores the marketing stage as one word. The app's screens use a status per contact count.
export function toMarketingStatus(marketing: string | null, totalContacts: number): MarketingStatus {
  const contacts = Math.max(0, totalContacts);
  const contactedStage: MarketingStatus = contacts >= 3 ? 'contacted_3' : contacts === 2 ? 'contacted_2' : 'contacted_1';

  switch (marketing) {
    case 'opted_out':
      return 'opted_out';
    case 'wrong_number':
      return 'wrong_number';
    case 'follow_up_due':
      return 'followup_due';
    case 'contacted':
    case 'responded':
      return contacts === 0 ? 'contacted_1' : contactedStage;
    default:
      return contacts > 0 ? contactedStage : 'never_marketed';
  }
}

// Business owners are recognised from their name. Anything else is an individual.
export function toOwnerType(ownerType: string | null, ownerName: string | null): OwnerType {
  if (ownerType !== 'Organization') return 'Individual';
  const name = (ownerName ?? '').toUpperCase();
  if (/\bTRUST\b/.test(name)) return 'Trust';
  if (/\bL\.?L\.?C\b/.test(name)) return 'LLC';
  return 'Corporation';
}

// One row from the search_properties() database function (supabase/migrations/007_properties_search.sql).
// It already derives the app status and the first phone number.
export interface PropertySearchRow {
  id: string;
  apn: string;
  owner_name: string | null;
  owner_type: string | null;
  state: string;
  county: string | null;
  zip_code: string | null;
  acres: string | number | null;
  status: MarketingStatus;
  marketing_status: string | null;
  total_contacts: number;
  last_contacted_at: string | null;
  first_acquired_at: string | null;
  created_at: string;
  phone: string | null;
  total_count: number | string;
}

export function toLandRecordFromSearch(row: PropertySearchRow): LandRecord {
  return {
    id: row.id,
    apn: row.apn,
    state: row.state,
    county: row.county ?? '',
    zip: row.zip_code ?? '',
    acres: Number(row.acres ?? 0),
    ownerName: row.owner_name ?? '',
    ownerType: toOwnerType(row.owner_type, row.owner_name),
    phone: row.phone ?? '',
    status: row.status,
    timesContacted: row.total_contacts,
    responded: row.marketing_status === 'responded',
    lastContactedAt: row.last_contacted_at,
    acquiredAt: row.first_acquired_at ?? row.created_at,
    assignedTo: null,
  };
}

export function toLandRecord(row: PropertyRow): LandRecord {
  // Phones linked to the property come first (imports save them there); owner phone lists are also used.
  const linked = (row.property_phones ?? []).flatMap((link) => (link.phone_numbers ? [link.phone_numbers.phone_number] : []));
  const fromOwners = (row.property_owners ?? []).flatMap((owner) => owner.phone_numbers ?? []);
  const phones = [...linked, ...fromOwners];
  const totalContacts = row.total_contacts ?? 0;
  return {
    id: row.id,
    apn: row.apn_raw ?? row.internal_id,
    state: row.state,
    county: row.county ?? '',
    zip: row.zip_code ?? '',
    acres: Number(row.acreage ?? 0),
    ownerName: row.owner_name ?? '',
    ownerType: toOwnerType(row.owner_type, row.owner_name),
    phone: phones[0] ?? '',
    status: toMarketingStatus(row.marketing_status, totalContacts),
    timesContacted: totalContacts,
    responded: row.marketing_status === 'responded',
    lastContactedAt: row.last_contacted_at,
    acquiredAt: row.first_acquired_at ?? row.created_at,
    assignedTo: null,
  };
}
