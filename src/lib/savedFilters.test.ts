import { describe, expect, it } from 'vitest';
import { criteriaToForm, EMPTY_FORM, formToCriteria, formToPanel, validateFilterName } from './savedFilters';

describe('formToPanel', () => {
  it('drops residential codes when the residential box is not ticked', () => {
    const panel = formToPanel({ ...EMPTY_FORM, fips: ['12067'], landUseCodes: ['1024'], residential: false });
    expect(panel.landUseCodes).toEqual([]);
  });

  it('keeps residential codes when ticked, and reads cities, ZIPs and ranges', () => {
    const panel = formToPanel({
      ...EMPTY_FORM,
      fips: ['12067'],
      landUseCodes: ['1024'],
      residential: true,
      cities: ['MAYO', 'OCEAN'],
      zips: ['32066'],
      acresMin: '1',
      acresMax: '',
    });
    expect(panel.landUseCodes).toEqual(['1024']);
    expect(panel.cities).toEqual(['MAYO', 'OCEAN']);
    expect(panel.zips).toEqual(['32066']);
    expect(panel.acres).toEqual({ min: 1, max: undefined });
  });
});

describe('criteria round trip', () => {
  it('restores exactly what was saved', () => {
    const form = { ...EMPTY_FORM, stateName: 'Florida', fips: ['12067', '12005'], cities: ['MAYO'], zips: ['32066'], vacantLots: true, vacantSources: ['L'], acresMin: '2' };
    expect(criteriaToForm(formToCriteria(form))).toEqual(form);
  });

  it('falls back to empty values for missing or wrong-type fields', () => {
    const form = criteriaToForm({ fips: 'not-a-list', cities: 'MAYO', vacantLots: 'yes', acresMin: 5 });
    expect(form).toEqual(EMPTY_FORM);
  });

  it('accepts a missing criteria object', () => {
    expect(criteriaToForm(null)).toEqual(EMPTY_FORM);
  });
});

describe('validateFilterName', () => {
  it('rejects blank and overlong names', () => {
    expect(validateFilterName('   ')).not.toBeNull();
    expect(validateFilterName('x'.repeat(81))).not.toBeNull();
    expect(validateFilterName('Lafayette vacant')).toBeNull();
  });
});
