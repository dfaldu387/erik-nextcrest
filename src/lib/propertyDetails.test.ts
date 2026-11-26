import { describe, expect, it } from 'vitest';
import { propertyDetailsFrom } from './importCommit';

describe('propertyDetailsFrom', () => {
  it('reads the mailing address and main details by header, ignoring case and spacing', () => {
    const headers = ['APN', 'Mail  Full Address', 'mail city', 'Mail State', 'Mail Zip', 'Latitude', 'Total Assessed Value', 'Year Built', 'Land Use', 'Notes'];
    const cells = ['1007', '123 Main St', 'Dallas', 'TX', '75201', '32.30', '$12,500', '1998', 'Vacant', ''];
    const details = propertyDetailsFrom(headers, cells);
    expect(details.mailing_address).toBe('123 Main St');
    expect(details.mailing_city).toBe('Dallas');
    expect(details.mailing_zip).toBe('75201');
    expect(details.latitude).toBe(32.3);
    expect(details.assessed_value).toBe(12500);
    expect(details.year_built).toBe(1998);
    expect(details.land_use).toBe('Vacant');
  });

  it('keeps every non-empty column in import_fields and leaves empty ones out', () => {
    const details = propertyDetailsFrom(['APN', 'Zoning', 'Notes'], ['1007', '', 'Corner lot']);
    expect(details.import_fields).toEqual({ APN: '1007', Notes: 'Corner lot' });
  });

  it('returns null for a missing or invalid value', () => {
    const details = propertyDetailsFrom(['Latitude', 'Year Built'], ['', 'n/a']);
    expect(details.latitude).toBeNull();
    expect(details.year_built).toBeNull();
    expect(details.mailing_address).toBeNull();
  });
});
