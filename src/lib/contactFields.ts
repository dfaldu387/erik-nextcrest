// The contact form: which fields exist, where each one is kept, and how the values combine.
// Fields with source 'smartercontact' save to SmarterContact (its API exposes them). Fields with source 'nextcrest'
// are kept in NextCrest, because SmarterContact's API does not expose them. 'readonly' fields only display.

import type { PropertyFacts } from '@/services/nextcrestData';

export type FieldSource = 'smartercontact' | 'nextcrest' | 'readonly';

export interface FieldDef {
  key: string;
  label: string;
  source: FieldSource;
  /** The SmarterContact field name, for source 'smartercontact'. */
  scName?: string;
  type?: 'text' | 'date' | 'select';
  options?: string[];
  /** Shown when nothing is saved yet, taken from the property record. */
  fromProperty?: (p: PropertyFacts) => string;
}

const sc = (key: string, label: string, scName: string): FieldDef => ({ key, label, source: 'smartercontact', scName });
const nc = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, source: 'nextcrest', ...extra });
const num = (value: number | null) => (value === null ? '' : String(value));

export const CONTACT_FIELDS: FieldDef[] = [
  sc('firstName', 'First name', 'First name'),
  sc('lastName', 'Last name', 'Last name'),
  { key: 'phone', label: 'Phone number', source: 'readonly' },
  sc('email', 'Email', 'Email'),
  sc('propertyAddress', 'Property address', 'Property Address'),
  sc('mailingAddress', 'Mailing address', 'Mailing Address'),
  sc('apn', "Assessor's parcel number (APN)", 'APN'),
  sc('parcelCounty', 'Parcel county', 'Parcel county'),
  sc('parcelAcres', 'Parcel acres', 'Parcel acres'),
  sc('parcelState', 'Parcel state', 'Parcel state'),
  { key: 'outbound', label: 'Outbound number', source: 'readonly' },
  { key: 'groups', label: 'Groups', source: 'readonly' },
  { key: 'labels', label: 'Labels', source: 'readonly' },
  { key: 'campaigns', label: 'Campaigns', source: 'readonly' },

  nc('bed', 'Bed'),
  nc('bath', 'Bath'),
  nc('zillowEstimate', 'Zillow estimate'),
  nc('yearBuilt', 'Year built', { fromProperty: (p) => num(p.yearBuilt) }),
  nc('owes', 'Owes'),
  nc('offer', 'Offer'),
  nc('sqFt', 'Sq Ft'),
  nc('lotSize', 'Lot size'),
  nc('occupancy', 'Occupancy', { type: 'select', options: ['Owner occupied', 'Tenant occupied', 'Vacant', 'Unknown'] }),
  nc('ac', 'AC'),
  nc('taxAssessment', 'Tax assessment', { fromProperty: (p) => num(p.assessedValue) }),
  nc('roof', 'Roof'),
  nc('garage', 'Garage'),
  nc('propertyType', 'Property type', { fromProperty: (p) => p.landUse }),
  nc('pool', 'Pool'),
  nc('repairs', 'Repairs'),
  nc('rent', 'Rent'),
  nc('lastSoldDate', 'Last sold date', { type: 'date' }),

  nc('ownerFullName', 'Owner full name', { fromProperty: (p) => p.ownerName }),
  nc('parcelCity', 'Parcel city', { fromProperty: (p) => p.propertyCity }),
  nc('femaFloodZone', 'FEMA flood zone'),
  nc('roadFrontage', 'Road frontage'),
  nc('latitude', 'Latitude', { fromProperty: (p) => num(p.latitude) }),
  nc('longitude', 'Longitude', { fromProperty: (p) => num(p.longitude) }),
  nc('tlpValue', 'TLP value'),
  nc('hyperlink', 'Hyperlink'),
  nc('parcelZip', 'Parcel zip', { fromProperty: (p) => p.propertyZip }),
  nc('zoning', 'Zoning', { fromProperty: (p) => p.zoning }),
  nc('lowerRange1', 'Lower range 1'),
  nc('lowerRange2', 'Lower range 2'),
  nc('lowerRange3', 'Lower range 3'),
  nc('lowerRange4', 'Lower range 4'),
  nc('originalRange', 'Original range'),

  nc('followUpOn', 'Follow up on', { type: 'date' }),
];

/** The current value of each field: SmarterContact's value, the saved NextCrest value, or the property's value when nothing is saved. */
export function currentValues(scValues: Record<string, string>, saved: Record<string, string>, property: PropertyFacts | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of CONTACT_FIELDS) {
    if (field.source === 'smartercontact') out[field.key] = scValues[field.scName ?? field.label] ?? '';
    else if (field.source === 'nextcrest') out[field.key] = saved[field.key] ?? (property && field.fromProperty ? field.fromProperty(property) : '');
  }
  return out;
}

/** Splits changed values into those for SmarterContact (by SmarterContact field name) and those kept in NextCrest. */
export function splitChanges(changed: Record<string, string>): { smartercontact: Record<string, string>; nextcrest: Record<string, string> } {
  const smartercontact: Record<string, string> = {};
  const nextcrest: Record<string, string> = {};
  for (const field of CONTACT_FIELDS) {
    if (!(field.key in changed)) continue;
    if (field.source === 'smartercontact' && field.scName) smartercontact[field.scName] = changed[field.key];
    else if (field.source === 'nextcrest') nextcrest[field.key] = changed[field.key];
  }
  return { smartercontact, nextcrest };
}
