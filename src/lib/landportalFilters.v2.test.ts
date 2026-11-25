import { describe, expect, it } from 'vitest';
import { countiesFromFips, landUseFromFlat } from './landportalFilters';

describe('countiesFromFips', () => {
  it('groups FIPS-keyed counties by state, using the FIPS prefix', () => {
    expect(countiesFromFips({ '12067': 'Lafayette', '12001': 'Alachua', '13001': 'Appling', '99999': 'Unknown' })).toEqual({
      Florida: { '12067': 'Lafayette', '12001': 'Alachua' },
      Georgia: { '13001': 'Appling' },
    });
  });

  it('returns nothing for a missing value', () => {
    expect(countiesFromFips(undefined)).toEqual({});
  });
});

describe('landUseFromFlat', () => {
  it('shows the flat code list as one group', () => {
    expect(landUseFromFlat({ '1000': 'Residential', '1024': 'Vacant' })).toEqual([
      {
        category: 'Land use codes',
        codes: [
          { code: '1000', label: 'Residential' },
          { code: '1024', label: 'Vacant' },
        ],
      },
    ]);
  });
});
