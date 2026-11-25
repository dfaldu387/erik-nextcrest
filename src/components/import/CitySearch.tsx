import { useMutation } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { type Column, DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/States';
import { downloadCsv, toCsv } from '@/lib/csv';
import { formatAcres, formatCount } from '@/lib/format';
import { filterProperties, LandPortalError } from '@/lib/landportal';

// Land Portal's filter endpoint needs a county FIPS code and a city name. Results are shown
// here only. Nothing is written to the database until the properties are imported.

export interface CityProperty {
  propertyId: string;
  apn: string;
  address: string;
  owner: string;
  acres: number | null;
  fips: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
}

export function toCityProperty(raw: Record<string, unknown>): CityProperty {
  const acres = raw.lotsizeacres == null ? NaN : Number(raw.lotsizeacres);
  return {
    propertyId: text(raw.propertyid),
    apn: text(raw.apn),
    address: text(raw.situsfullstreetaddress),
    owner: text(raw.ownername1full),
    acres: Number.isFinite(acres) ? acres : null,
    fips: text(raw.fips),
  };
}

const COLUMNS: Column<CityProperty>[] = [
  {
    key: 'owner',
    header: 'Owner',
    cell: (p) => <span className="font-medium">{p.owner || '—'}</span>,
    sortValue: (p) => p.owner,
    searchValue: (p) => p.owner,
  },
  {
    key: 'apn',
    header: 'APN',
    cell: (p) => <span className="whitespace-nowrap font-mono text-xs">{p.apn || '—'}</span>,
    hideBelow: 'md',
    sortValue: (p) => p.apn,
    searchValue: (p) => p.apn,
  },
  {
    key: 'address',
    header: 'Address',
    cell: (p) => p.address || '—',
    hideBelow: 'md',
    sortValue: (p) => p.address,
    searchValue: (p) => p.address,
  },
  {
    key: 'acres',
    header: 'Acres',
    cell: (p) => (p.acres === null ? '—' : formatAcres(p.acres)),
    hideBelow: 'lg',
    sortValue: (p) => p.acres,
  },
  {
    key: 'propertyId',
    header: 'Land Portal ID',
    cell: (p) => <span className="font-mono text-xs text-muted-foreground">{p.propertyId}</span>,
    hideBelow: 'lg',
    sortValue: (p) => p.propertyId,
    searchValue: (p) => p.propertyId,
  },
];

interface SearchInput {
  fips: string;
  city: string;
}

interface SearchOutcome {
  input: SearchInput;
  rows: CityProperty[];
  count: number;
  requestsLeft: number | undefined;
}

export function CitySearch() {
  const [fips, setFips] = useState('');
  const [city, setCity] = useState('');
  const [validation, setValidation] = useState<string | null>(null);

  const search = useMutation<SearchOutcome, Error, SearchInput>({
    mutationFn: async (input) => {
      const result = await filterProperties({
        filters: {
          fips: { operator: 'condition', comparison: 'is', value: [input.fips] },
          situscity: { operator: 'condition', comparison: 'is', value: input.city },
        },
      });
      return {
        input,
        rows: result.data.properties.map(toCityProperty),
        count: result.data.count,
        requestsLeft: result.meta.requests_left,
      };
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanFips = fips.trim();
    const cleanCity = city.trim();
    if (!/^\d{5}$/.test(cleanFips)) {
      setValidation('Enter a 5-digit county FIPS code, for example 12067 for Lafayette County, FL.');
      return;
    }
    if (!cleanCity) {
      setValidation('Enter a city name.');
      return;
    }
    setValidation(null);
    // Land Portal matches city names in uppercase only ("Mayo" returns nothing, "MAYO" matches).
    search.mutate({ fips: cleanFips, city: cleanCity.toUpperCase() });
  };

  const outcome = search.data;
  const errorMessage =
    search.error instanceof LandPortalError ? search.error.message : search.error ? 'The search could not be completed.' : null;

  const exportResults = () => {
    if (!outcome) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const safeCity = outcome.input.city.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    downloadCsv(
      `landportal-${outcome.input.fips}-${safeCity}-${stamp}.csv`,
      toCsv(
        ['APN', 'Owner', 'Address', 'Acres', 'Land Portal ID', 'County FIPS'],
        outcome.rows.map((p) => [p.apn, p.owner, p.address, p.acres, p.propertyId, p.fips]),
      ),
    );
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="card grid gap-4 p-5 md:grid-cols-[1fr_1fr_auto] md:items-end" aria-label="Search a city in Land Portal">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          County FIPS code
          <input
            value={fips}
            onChange={(e) => setFips(e.target.value)}
            inputMode="numeric"
            maxLength={5}
            placeholder="12067"
            className="field font-mono"
          />
          <span className="font-normal">Lafayette County, FL is 12067.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          City
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Mayo" className="field" />
          <span className="font-normal">Matched as uppercase in Land Portal.</span>
        </label>
        <button type="submit" className="btn-primary h-10" disabled={search.isPending}>
          <Search size={16} aria-hidden="true" /> {search.isPending ? 'Searching…' : 'Search city'}
        </button>
      </form>

      {validation && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{validation}</p>}
      {errorMessage && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {errorMessage}
        </p>
      )}

      {outcome && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <p className="text-sm" aria-live="polite">
              <span className="font-semibold">{formatCount(outcome.count)}</span> properties in{' '}
              <span className="font-medium">{outcome.input.city}</span> (FIPS {outcome.input.fips})
              {outcome.requestsLeft !== undefined && (
                <span className="ml-2 text-xs text-muted-foreground">{formatCount(outcome.requestsLeft)} requests left today</span>
              )}
            </p>
            {outcome.rows.length > 0 && (
              <button type="button" className="btn-secondary h-9" onClick={exportResults}>
                <Download size={14} aria-hidden="true" /> Download CSV
              </button>
            )}
          </div>
          <DataTable<CityProperty>
            caption={`Land Portal properties in ${outcome.input.city}`}
            rows={outcome.rows}
            rowKey={(p) => `${p.fips}-${p.propertyId}`}
            columns={COLUMNS}
            defaultPageSize={25}
            searchPlaceholder="Search owner, APN, address"
            empty={
              <EmptyState
                title="No properties in this city"
                description="Check the county FIPS code and the city spelling used in county records."
              />
            }
          />
        </div>
      )}
    </div>
  );
}
