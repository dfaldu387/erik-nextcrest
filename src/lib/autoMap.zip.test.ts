import { describe, expect, it } from 'vitest';
import { autoMap } from '@/lib/autoMap';

// Regression: a sparse 5-digit column ("MLS sqft") was mapped to ZIP ahead of a full "Parcel Zip" column.
describe('autoMap ZIP selection', () => {
  const zips = ['28443', '28443', '28425', '28443', '28445', '28443', '28443', '28478', '06853', '19040'];
  const headers = ['Parcel Zip', 'MLS sqft', 'Parcel County'];
  const rows = zips.map((zip, i) => [zip, i < 3 ? String(16553 + i * 1000) : '', 'Pender']);

  it('maps ZIP to the full Parcel Zip column', () => {
    const { mapping } = autoMap(headers, rows);
    expect(mapping.zip).toBe(0);
  });

  it('keeps the sparse column from taking ZIP', () => {
    const { mapping } = autoMap(headers, rows);
    expect(mapping.zip).not.toBe(1);
  });
});
