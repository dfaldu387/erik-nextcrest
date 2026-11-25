import { describe, expect, it } from 'vitest';
import type { LandRecord } from '@/data/types';
import { toSmarterContactRow } from './campaignExport';
import { formatEntityName, formatOwnerParts, formatPersonName, splitOwner } from './owner';

describe('formatPersonName', () => {
  it('uses title case for first and last names', () => {
    expect(formatPersonName('JOHN')).toBe('John');
    expect(formatPersonName('mary  JANE')).toBe('Mary Jane');
  });

  it('capitalises after hyphens and apostrophes', () => {
    expect(formatPersonName("O'BRIEN")).toBe("O'Brien");
    expect(formatPersonName('SMITH-JONES')).toBe('Smith-Jones');
  });
});

describe('formatEntityName', () => {
  it('keeps LLC and other legal suffixes in capitals', () => {
    expect(formatEntityName('SMITH FARMS LLC')).toBe('Smith Farms LLC');
    expect(formatEntityName('acme holdings l.l.c.')).toBe('Acme Holdings LLC');
    expect(formatEntityName('DELTA PARTNERS LP')).toBe('Delta Partners LP');
  });

  it('title-cases other entity words', () => {
    expect(formatEntityName('PINE RIDGE TRUST')).toBe('Pine Ridge Trust');
  });
});

describe('SmarterContact name output', () => {
  it('formats a person into First Name and Last Name', () => {
    expect(formatOwnerParts(splitOwner('SMITH JOHN ALBERT'))).toEqual({
      isEntity: false,
      first: 'Smith John',
      last: 'Albert',
    });
  });

  it('keeps an entity whole in First Name with suffix in capitals', () => {
    expect(formatOwnerParts(splitOwner('SMITH FARMS llc'))).toEqual({
      isEntity: true,
      first: 'Smith Farms LLC',
      last: '',
    });
  });

  it('is applied in the SmarterContact export row', () => {
    const record = {
      ownerName: 'DOE JANE',
      phone: '(352) 555-0100',
      apn: '12-34',
      county: 'Lafayette',
      state: 'FL',
      acres: 5,
    } as LandRecord;
    expect(toSmarterContactRow(record)).toEqual(['Doe', 'Jane', '3525550100', '12-34', 'Lafayette', 'FL', 5]);
  });
});
