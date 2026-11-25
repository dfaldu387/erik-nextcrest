import { describe, expect, it } from 'vitest';
import { autoMap } from './autoMap';

// Synthetic rows that follow the real formats (APN with separators, two-letter states,
// acreage with decimals, 10-digit phones). No real owner data is used here.
// The ZIP column carries a header hint because 5-digit codes alone cannot separate ZIP from FIPS.
const HEADERS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'Zip'];

const ROWS: string[][] = [
  ['31-06-14-0000-0000-00400', 'Lafayette', 'FL', '9.21', 'Acme Holdings LLC', '(352) 555-0101', '32008'],
  ['04-05-11-0000-0000-00201', 'Lafayette', 'FL', '14.68', 'Jane Doe', '(352) 555-0102', '32066'],
  ['09-04-10-0000-0000-00303', 'Lafayette', 'FL', '12.70', 'John Roe Trust', '', '32066'],
  ['10-02-11-0000-0000-00404', 'Lafayette', 'FL', '5.00', 'Mary Poe', '(352) 555-0104', '32008'],
  ['11-03-12-0000-0000-00505', 'Lafayette', 'FL', '7.50', 'Sam Smith', '(352) 555-0105', '32066'],
];

describe('value-based auto mapping', () => {
  it('finds the APN, state, county, acreage, owner, phone and ZIP from their values alone', () => {
    const { mapping } = autoMap(HEADERS, ROWS);
    expect(mapping.apn).toBe(0);
    expect(mapping.county).toBe(1);
    expect(mapping.state).toBe(2);
    expect(mapping.acres).toBe(3);
    expect(mapping.ownerName).toBe(4);
    expect(mapping.phone).toBe(5);
    expect(mapping.zip).toBe(6);
  });

  it('does not use one column for two fields', () => {
    const { mapping } = autoMap(HEADERS, ROWS);
    const used = Object.values(mapping).filter((i) => i >= 0);
    expect(new Set(used).size).toBe(used.length);
  });

  it('leaves a field unmapped when no column looks like it', () => {
    const rows = [['x', 'y'], ['z', 'w']];
    const { mapping } = autoMap(['a', 'b'], rows);
    expect(mapping.phone).toBe(-1);
    expect(mapping.fips).toBe(-1);
  });

  it('separates a county FIPS column from a ZIP column when the headers say which is which', () => {
    const rows = [
      ['12067', '32008'],
      ['12067', '32066'],
      ['12079', '32010'],
      ['12079', '32011'],
    ];
    const { mapping } = autoMap(['Parcel FIPS', 'Parcel Zip'], rows);
    expect(mapping.fips).toBe(0);
    expect(mapping.zip).toBe(1);
  });

  it('does not guess between FIPS and ZIP when a 5-digit column has no header hint', () => {
    const rows = [
      ['32008'],
      ['32066'],
      ['32010'],
    ];
    const { mapping } = autoMap(['col'], rows);
    expect(mapping.fips).toBe(-1);
    expect(mapping.zip).toBe(-1);
  });

  it('reports a confidence for each mapped field', () => {
    const { confidence } = autoMap(HEADERS, ROWS);
    expect(confidence.apn).toBeGreaterThanOrEqual(0.6);
    expect(confidence.state).toBeGreaterThanOrEqual(0.6);
  });
});
