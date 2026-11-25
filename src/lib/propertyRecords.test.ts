import { describe, expect, it } from 'vitest';
import { type PropertyRow, toLandRecord, toMarketingStatus, toOwnerType } from './propertyRecords';

const base: PropertyRow = {
  id: 'p1',
  internal_id: 'LP-12067-1',
  apn_raw: '33-04-11-0000-0000-00601',
  state: 'FL',
  county: 'Lafayette',
  zip_code: null,
  acreage: '1.7000',
  owner_name: 'HYDE JIMMY A',
  owner_type: 'Individual',
  marketing_status: 'never_contacted',
  total_contacts: 0,
  last_contacted_at: null,
  first_acquired_at: '2026-11-21T00:00:00Z',
  created_at: '2026-11-21T00:00:00Z',
  property_owners: [],
};

describe('toMarketingStatus', () => {
  it('maps an uncontacted property to never marketed', () => {
    expect(toMarketingStatus('never_contacted', 0)).toBe('never_marketed');
  });

  it('maps the contact count to the matching contact stage', () => {
    expect(toMarketingStatus('contacted', 1)).toBe('contacted_1');
    expect(toMarketingStatus('contacted', 2)).toBe('contacted_2');
    expect(toMarketingStatus('contacted', 5)).toBe('contacted_3');
  });

  it('maps the database follow-up and terminal states', () => {
    expect(toMarketingStatus('follow_up_due', 2)).toBe('followup_due');
    expect(toMarketingStatus('opted_out', 1)).toBe('opted_out');
    expect(toMarketingStatus('wrong_number', 1)).toBe('wrong_number');
  });

  it('uses the contact count when the stage still says never contacted', () => {
    expect(toMarketingStatus('never_contacted', 3)).toBe('contacted_3');
  });
});

describe('toOwnerType', () => {
  it('keeps individuals as individuals', () => {
    expect(toOwnerType('Individual', 'HYDE JIMMY A')).toBe('Individual');
  });

  it('recognises trusts, LLCs and corporations from the name', () => {
    expect(toOwnerType('Organization', 'Trust No 35-07-13')).toBe('Trust');
    expect(toOwnerType('Organization', 'HTFF FL-T LLC')).toBe('LLC');
    expect(toOwnerType('Organization', 'HTFF TRS INC')).toBe('Corporation');
  });
});

describe('toLandRecord', () => {
  it('takes the phone from linked phone numbers when the owner has none', () => {
    const record = toLandRecord({
      ...base,
      property_owners: [],
      property_phones: [{ phone_numbers: { phone_number: '9035550100' } }],
    });
    expect(record.phone).toBe('9035550100');
  });

  it('maps a database row onto the record the screens use', () => {
    const record = toLandRecord({
      ...base,
      property_owners: [{ phone_numbers: ['3525550100'] }],
    });
    expect(record).toEqual({
      id: 'p1',
      apn: '33-04-11-0000-0000-00601',
      state: 'FL',
      county: 'Lafayette',
      zip: '',
      acres: 1.7,
      ownerName: 'HYDE JIMMY A',
      ownerType: 'Individual',
      phone: '3525550100',
      status: 'never_marketed',
      timesContacted: 0,
      responded: false,
      lastContactedAt: null,
      acquiredAt: '2026-11-21T00:00:00Z',
      assignedTo: null,
    });
  });

  it('falls back to the internal id when there is no APN and to an empty phone when there is none', () => {
    const record = toLandRecord({ ...base, apn_raw: null });
    expect(record.apn).toBe('LP-12067-1');
    expect(record.phone).toBe('');
  });

  it('marks a responded property as responded', () => {
    const record = toLandRecord({ ...base, marketing_status: 'responded', total_contacts: 2 });
    expect(record.responded).toBe(true);
    expect(record.status).toBe('contacted_2');
  });
});
