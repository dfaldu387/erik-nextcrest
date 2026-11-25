import { describe, expect, it } from 'vitest';
import type { LandRecord } from '@/data/types';
import { normalizePhone, planCampaignExport, toSmarterContactRow } from './campaignExport';
import { applyListFilters, emptyFilters } from './listFilters';
import { buildCampaigns, buildMarkets } from './metrics';
import { splitOwner } from './owner';

const DAY = 24 * 60 * 60 * 1000;

function record(overrides: Partial<LandRecord>): LandRecord {
  return {
    id: 'r',
    apn: '001-234-567',
    state: 'TX',
    county: 'Bexar',
    zip: '78201',
    acres: 10,
    ownerName: 'John Smith',
    ownerType: 'Individual',
    phone: '(210) 555-0100',
    status: 'never_marketed',
    timesContacted: 0,
    responded: false,
    lastContactedAt: null,
    acquiredAt: '2026-01-01T00:00:00.000Z',
    assignedTo: null,
    ...overrides,
  };
}

describe('owner name rules', () => {
  it('keeps organisations whole in First Name', () => {
    expect(splitOwner('Smith Family Trust')).toEqual({ isEntity: true, first: 'Smith Family Trust', last: '' });
    expect(splitOwner('Triangle Development Group LLC').isEntity).toBe(true);
  });

  it('does not treat names containing entity letters as organisations', () => {
    expect(splitOwner('Coe Lopez')).toEqual({ isEntity: false, first: 'Coe', last: 'Lopez' });
  });

  it('splits individuals on the last word', () => {
    expect(splitOwner('Maria de la Cruz')).toEqual({ isEntity: false, first: 'Maria de la', last: 'Cruz' });
  });
});

describe('campaign export suppression', () => {
  it('excludes opt-outs, wrong numbers, responders and missing phones, with counts', () => {
    const plan = planCampaignExport([
      record({ id: '1', status: 'opted_out' }),
      record({ id: '2', status: 'wrong_number' }),
      record({ id: '3', responded: true, status: 'contacted_1' }),
      record({ id: '4', phone: '' }),
      record({ id: '5', phone: '(210) 555-0199' }),
      record({ id: '6', phone: '210.555.0199' }),
    ]);
    expect(plan.included.map((r) => r.id)).toEqual(['5']);
    expect(plan.excluded['Opted out']).toBe(1);
    expect(plan.excluded['Wrong number']).toBe(1);
    expect(plan.excluded['Responder (handled manually)']).toBe(1);
    expect(plan.excluded['Missing phone']).toBe(1);
    expect(plan.excluded['Duplicate phone']).toBe(1);
    expect(plan.total).toBe(6);
  });

  it('normalises phone numbers to ten digits', () => {
    expect(normalizePhone('+1 (210) 555-0100')).toBe('2105550100');
    expect(normalizePhone('555-0100')).toBe('');
  });

  it('puts organisation names in First Name for SmarterContact', () => {
    const row = toSmarterContactRow(record({ ownerName: 'Smith Family LLC', ownerType: 'LLC' }));
    expect(row[0]).toBe('Smith Family LLC');
    expect(row[1]).toBe('');
  });
});

describe('list filters', () => {
  const records = [
    record({ id: 'a', county: 'Bexar', acres: 5, timesContacted: 0 }),
    record({ id: 'b', county: 'Harris', state: 'TX', acres: 120, timesContacted: 3 }),
  ];

  it('returns everything with empty filters', () => {
    expect(applyListFilters(records, emptyFilters)).toHaveLength(2);
  });

  it('filters by county and acreage range', () => {
    const result = applyListFilters(records, { ...emptyFilters, minAcres: '100' });
    expect(result.map((r) => r.id)).toEqual(['b']);
  });

  it('filters by contact count', () => {
    const result = applyListFilters(records, { ...emptyFilters, maxContacts: '0' });
    expect(result.map((r) => r.id)).toEqual(['a']);
  });
});

describe('derived markets and campaigns', () => {
  const now = Date.now();
  const records = [
    record({ id: 'a', timesContacted: 1, lastContactedAt: new Date(now - 30 * DAY).toISOString(), responded: true }),
    record({ id: 'b', timesContacted: 0 }),
  ];

  it('builds a dataset name in the agreed format', () => {
    const [market] = buildMarkets(records, now);
    expect(market.name).toMatch(/^TX_Bexar_10yr_\d+-\d+ac_[A-Za-z]{3}\d{4}_2$/);
  });

  it('schedules the re-hit 60 days out for a record contacted 30 days ago', () => {
    const [market] = buildMarkets(records, now);
    const days = Math.round((new Date(market.nextRehitAt).getTime() - now) / DAY);
    expect(days).toBe(60);
  });

  it('counts texts, replies and reply rate per county', () => {
    const [campaign] = buildCampaigns(records);
    expect(campaign.sent).toBe(1);
    expect(campaign.responses).toBe(1);
    expect(campaign.responseRate).toBe(100);
  });
});
