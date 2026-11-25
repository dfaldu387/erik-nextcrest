export type MarketingStatus =
  | 'never_marketed'
  | 'contacted_1'
  | 'contacted_2'
  | 'contacted_3'
  | 'followup_due'
  | 'rehit_due'
  | 'wrong_number'
  | 'opted_out';

export type OwnerType = 'Individual' | 'LLC' | 'Trust' | 'Corporation';

export interface LandRecord {
  id: string;
  apn: string;
  state: string;
  county: string;
  zip: string;
  acres: number;
  ownerName: string;
  ownerType: OwnerType;
  phone: string;
  status: MarketingStatus;
  timesContacted: number;
  responded: boolean;
  lastContactedAt: string | null;
  acquiredAt: string;
  assignedTo: string | null;
}

export interface Market {
  id: string;
  name: string;
  state: string;
  county: string;
  acreRange: string;
  ownership: string;
  purchasedAt: string;
  recordCount: number;
  avgContacts: number;
  responseRate: number;
  contactedShare: number;
  nextRehitAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  state: string;
  county: string;
  contacted: number;
  sent: number;
  responses: number;
  wrongNumbers: number;
  optOuts: number;
  responseRate: number;
  lastActivityAt: string | null;
}

export interface ActivityEvent {
  id: string;
  user: string;
  action: string;
  at: string;
}

export interface DataResult<T> {
  data: T;
  source: 'supabase' | 'none';
  fetchedAt: string;
}
