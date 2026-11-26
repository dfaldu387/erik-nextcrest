import { describe, expect, it } from 'vitest';
import { currentValues, splitChanges } from './contactFields';

describe('splitChanges', () => {
  it('sends SmarterContact fields by their SmarterContact name and keeps the rest in NextCrest', () => {
    const result = splitChanges({ apn: '1007', bed: '3', email: 'a@b.co', followUpOn: '2026-12-01' });
    expect(result.smartercontact).toEqual({ APN: '1007', Email: 'a@b.co' });
    expect(result.nextcrest).toEqual({ bed: '3', followUpOn: '2026-12-01' });
  });

  it('ignores read-only fields', () => {
    const result = splitChanges({ phone: '9039871397', labels: 'WN' });
    expect(result.smartercontact).toEqual({});
    expect(result.nextcrest).toEqual({});
  });
});

describe('currentValues', () => {
  it('uses the saved value first, then the property value, then empty', () => {
    const property = { ownerName: 'Adams Charles', propertyCity: 'Henderson', latitude: 32.3, longitude: null, yearBuilt: null, assessedValue: null, landUse: '', propertyZip: '75654', zoning: '' } as never;
    const values = currentValues({ APN: '1007' }, { ownerFullName: 'Saved Owner' }, property);
    expect(values.apn).toBe('1007');
    expect(values.ownerFullName).toBe('Saved Owner');
    expect(values.parcelCity).toBe('Henderson');
    expect(values.latitude).toBe('32.3');
    expect(values.bed).toBe('');
  });
});
