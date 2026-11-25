import { describe, expect, it } from 'vitest';
import { toCityProperty } from './CitySearch';

describe('toCityProperty', () => {
  it('maps a Land Portal filter row to the table shape', () => {
    const row = toCityProperty({
      fips: '12067',
      apn: '33-04-11-0000-0000-00601',
      situsfullstreetaddress: '2856 W US 27',
      ownername1full: 'HYDE JIMMY A',
      lotsizeacres: 1.7,
      propertyid: 30615211,
    });
    expect(row).toEqual({
      propertyId: '30615211',
      apn: '33-04-11-0000-0000-00601',
      address: '2856 W US 27',
      owner: 'HYDE JIMMY A',
      acres: 1.7,
      fips: '12067',
    });
  });

  it('leaves missing values empty instead of inventing them', () => {
    const row = toCityProperty({ propertyid: 1, lotsizeacres: null });
    expect(row.acres).toBeNull();
    expect(row.owner).toBe('');
    expect(row.address).toBe('');
  });
});
