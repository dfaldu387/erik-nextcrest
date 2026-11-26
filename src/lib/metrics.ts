import type { Campaign, LandRecord, Market } from '@/data/types';
import { daysSince } from './format';

export interface PortfolioSummary {
  total: number;
  neverMarketed: number;
  followUpDue: number;
  rehitDue: number;
  wrongNumbers: number;
  optedOut: number;
  reachedAtLeast1: number;
  reachedAtLeast2: number;
  reachedAtLeast3: number;
  responded: number;
}

export function summarize(records: LandRecord[]): PortfolioSummary {
  const count = (predicate: (r: LandRecord) => boolean) => records.filter(predicate).length;
  return {
    total: records.length,
    neverMarketed: count((r) => r.status === 'never_marketed'),
    followUpDue: count((r) => r.status === 'followup_due'),
    rehitDue: count((r) => r.status === 'rehit_due'),
    wrongNumbers: count((r) => r.status === 'wrong_number'),
    optedOut: count((r) => r.status === 'opted_out'),
    reachedAtLeast1: count((r) => r.timesContacted >= 1),
    reachedAtLeast2: count((r) => r.timesContacted >= 2),
    reachedAtLeast3: count((r) => r.timesContacted >= 3),
    responded: count((r) => r.responded),
  };
}

function groupByCounty(records: LandRecord[]): LandRecord[][] {
  const groups = new Map<string, LandRecord[]>();
  for (const record of records) {
    const key = `${record.state}|${record.county}`;
    const existing = groups.get(key);
    if (existing) existing.push(record);
    else groups.set(key, [record]);
  }
  return [...groups.values()];
}

// A dataset is one county purchase. Its name follows State_County_Ownership_Acres_Month_Count.
export function buildMarkets(records: LandRecord[], now = Date.now()): Market[] {
  return groupByCounty(records).map((group) => {
    const { state, county } = group[0];
    const acres = group.map((r) => r.acres);
    const minAcres = Math.floor(Math.min(...acres));
    const maxAcres = Math.ceil(Math.max(...acres));
    const purchasedAt = group.reduce((earliest, r) => (r.acquiredAt < earliest ? r.acquiredAt : earliest), group[0].acquiredAt);
    const contacted = group.filter((r) => r.timesContacted > 0);
    const responded = group.filter((r) => r.responded).length;

    // Days until the next 90-day re-hit, using the most recently contacted record that is not yet due.
    const sinceContact = contacted
      .map((r) => daysSince(r.lastContactedAt, now))
      .filter((d): d is number => d !== null);
    const upcoming = sinceContact.filter((d) => d < 90);
    const nextRehitDays = sinceContact.length === 0 ? 90 : upcoming.length === 0 ? 0 : 90 - Math.max(...upcoming);

    const label = marketLabel(state, county, minAcres, maxAcres, purchasedAt, group.length);

    return {
      id: label.id,
      name: label.name,
      state,
      county,
      acreRange: `${minAcres}-${maxAcres}ac`,
      ownership: '10yr',
      purchasedAt,
      recordCount: group.length,
      avgContacts: Math.round((group.reduce((sum, r) => sum + r.timesContacted, 0) / group.length) * 10) / 10,
      responseRate: contacted.length ? Math.round((responded / contacted.length) * 100) : 0,
      contactedShare: Math.round((contacted.length / group.length) * 100),
      nextRehitAt: new Date(now + nextRehitDays * 24 * 60 * 60 * 1000).toISOString(),
    };
  });
}

// Campaign totals are derived from each record's contact history. Per-message history needs SmarterContact.
export function buildCampaigns(records: LandRecord[]): Campaign[] {
  return groupByCounty(records).map((group) => {
    const { state, county } = group[0];
    const contacted = group.filter((r) => r.timesContacted > 0);
    const responses = group.filter((r) => r.responded).length;
    const lastActivityAt =
      group
        .map((r) => r.lastContactedAt)
        .filter((v): v is string => v !== null)
        .sort()
        .at(-1) ?? null;

    return {
      id: `${state}-${county}`.toLowerCase(),
      name: `${county} County contact history`,
      state,
      county,
      contacted: contacted.length,
      sent: group.reduce((sum, r) => sum + r.timesContacted, 0),
      responses,
      wrongNumbers: group.filter((r) => r.status === 'wrong_number').length,
      optOuts: group.filter((r) => r.status === 'opted_out').length,
      responseRate: contacted.length ? Math.round((responses / contacted.length) * 100) : 0,
      lastActivityAt,
    };
  });
}

/** The id and name of a county market. Shared by the list of markets and the property page's dataset label. */
export function marketLabel(state: string, county: string, minAcres: number, maxAcres: number, purchasedAt: string, count: number): { id: string; name: string } {
  const monthYear = new Date(purchasedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).replace(' ', '');
  return {
    id: `${state}-${county}`.toLowerCase(),
    name: `${state}_${county}_10yr_${minAcres}-${maxAcres}ac_${monthYear}_${count}`,
  };
}
