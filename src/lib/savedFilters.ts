// The Search & Buy filter form as one object, so a saved filter can store every field and restore it exactly.

import { parseBound, type PanelFilters } from './landportalFilters';

export interface FilterForm {
  stateName: string;
  fips: string[];
  cities: string[];
  zips: string[];
  vacantLots: boolean;
  vacantSources: string[];
  residential: boolean;
  landUseCodes: string[];
  acresMin: string;
  acresMax: string;
  sqftMin: string;
  sqftMax: string;
}

export const EMPTY_FORM: FilterForm = {
  stateName: '',
  fips: [],
  cities: [],
  zips: [],
  vacantLots: false,
  vacantSources: [],
  residential: false,
  landUseCodes: [],
  acresMin: '',
  acresMax: '',
  sqftMin: '',
  sqftMax: '',
};

// Turns the form into the filter object the search uses. Residential codes apply only when the box is ticked.
export function formToPanel(form: FilterForm): PanelFilters {
  return {
    fips: form.fips,
    cities: form.cities,
    zips: form.zips,
    vacantLots: form.vacantLots,
    vacantSources: form.vacantSources,
    landUseCodes: form.residential ? form.landUseCodes : [],
    acres: { min: parseBound(form.acresMin), max: parseBound(form.acresMax) },
    lotSqft: { min: parseBound(form.sqftMin), max: parseBound(form.sqftMax) },
  };
}

// Reads a saved filter back into a form. Anything missing or of the wrong type falls back to the empty value,
// so a saved filter never breaks the page.
export function criteriaToForm(criteria: unknown): FilterForm {
  const c = criteria && typeof criteria === 'object' ? (criteria as Record<string, unknown>) : {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    stateName: text(c.stateName),
    fips: list(c.fips),
    cities: list(c.cities),
    zips: list(c.zips),
    vacantLots: c.vacantLots === true,
    vacantSources: list(c.vacantSources),
    residential: c.residential === true,
    landUseCodes: list(c.landUseCodes),
    acresMin: text(c.acresMin),
    acresMax: text(c.acresMax),
    sqftMin: text(c.sqftMin),
    sqftMax: text(c.sqftMax),
  };
}

export function formToCriteria(form: FilterForm): Record<string, unknown> {
  return { ...form };
}

// Names are 1 to 80 characters after trimming, the same rule the database enforces.
export function validateFilterName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Give the filter a name.';
  if (trimmed.length > 80) return 'Keep the name to 80 characters or fewer.';
  return null;
}
