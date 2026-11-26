import { describe, expect, it } from 'vitest';
import type { LandRecord } from '@/data/types';
import { planCampaignExport } from './campaignExport';

const PHONE_REASON = 'Phone opted out (SmarterContact or suppression list)';

function record(id: string, phone: string, overrides: Partial<LandRecord> = {}): LandRecord {
  return { id, phone, status: 'contacted_1', responded: false, ...overrides } as unknown as LandRecord;
}

describe('planCampaignExport with suppressed phones', () => {
  it('leaves out a record whose phone is on the opt-out list', () => {
    const plan = planCampaignExport([record('a', '3373050777'), record('b', '9413500116')], new Set(['3373050777']));
    expect(plan.included.map((r) => r.id)).toEqual(['b']);
    expect(plan.excluded[PHONE_REASON]).toBe(1);
  });

  it('matches numbers written in different formats', () => {
    const plan = planCampaignExport([record('a', '+1 (337) 305-0777')], new Set(['3373050777']));
    expect(plan.included).toHaveLength(0);
    expect(plan.excluded[PHONE_REASON]).toBe(1);
  });

  it('keeps every record when no suppressed numbers are given', () => {
    const plan = planCampaignExport([record('a', '3373050777')]);
    expect(plan.included).toHaveLength(1);
    expect(plan.excluded[PHONE_REASON]).toBe(0);
  });

  it('still reports the existing opt-out status before the phone list', () => {
    const plan = planCampaignExport([record('a', '3373050777', { status: 'opted_out' })], new Set(['3373050777']));
    expect(plan.excluded['Opted out']).toBe(1);
    expect(plan.excluded[PHONE_REASON]).toBe(0);
  });
});
