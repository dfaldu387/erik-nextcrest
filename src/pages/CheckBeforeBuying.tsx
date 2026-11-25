import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { usePropertyFilterOptionsQuery } from '@/hooks/useNextCrestData';
import { buildExclusionRows, EXCLUSION_HEADERS, exclusionFilename } from '@/lib/exclusionFile';
import { downloadCsv, toCsv } from '@/lib/csv';
import { formatCount, formatTime } from '@/lib/format';
import {
  type ExclusionExportRecord,
  getOwnedParcels,
  listExclusionExports,
  recordExclusionExport,
} from '@/services/nextcrestData';

const LAST_GENERATED_KEY = 'nextcrest.exclusion.lastGenerated';

function readLastGenerated(): string | null {
  try {
    return window.localStorage.getItem(LAST_GENERATED_KEY);
  } catch {
    return null; // Storage can be blocked. The date is a convenience, not required data.
  }
}

function writeLastGenerated(iso: string): void {
  try {
    window.localStorage.setItem(LAST_GENERATED_KEY, iso);
  } catch {
    // Ignore. See readLastGenerated.
  }
}

// Text used in the file name and the history table: one county, or a count when several are chosen.
function marketLabel(counties: string[]): string {
  return counties.length === 1 ? counties[0] : `${counties.length} counties`;
}

const HISTORY_COLUMNS: Column<ExclusionExportRecord>[] = [
  {
    key: 'created',
    header: 'Generated',
    cell: (e) => <span className="whitespace-nowrap text-xs">{formatTime(e.created_at)}</span>,
    sortValue: (e) => e.created_at,
    searchValue: (e) => e.created_at,
  },
  { key: 'state', header: 'State', cell: (e) => e.state, sortValue: (e) => e.state, searchValue: (e) => e.state },
  {
    key: 'counties',
    header: 'Counties',
    cell: (e) => e.counties.join(', '),
    sortValue: (e) => e.counties.join(', '),
    searchValue: (e) => e.counties.join(' '),
  },
  {
    key: 'parcels',
    header: 'Parcels',
    cell: (e) => <span className="tabular-nums">{formatCount(e.parcel_count)}</span>,
    sortValue: (e) => e.parcel_count,
  },
  {
    key: 'file',
    header: 'File',
    cell: (e) => <span className="font-mono text-xs">{e.filename}</span>,
    sortValue: (e) => e.filename,
    searchValue: (e) => e.filename,
    hideBelow: 'md',
  },
];

export function CheckBeforeBuying() {
  const queryClient = useQueryClient();
  const options = usePropertyFilterOptionsQuery();
  const [state, setState] = useState('');
  const [selectedCounties, setSelectedCounties] = useState<string[]>([]);
  const [lastGenerated, setLastGenerated] = useState<string | null>(readLastGenerated);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);

  const places = options.data?.places;
  const states = useMemo(() => [...new Set((places ?? []).map((p) => p.state))].sort(), [places]);
  const counties = useMemo(
    () => (places ?? []).filter((p) => p.state === state).map((p) => p.county).sort(),
    [places, state],
  );

  const countyKey = [...selectedCounties].sort().join('|');
  const parcels = useQuery({
    queryKey: ['owned-parcels', state, countyKey],
    queryFn: async () => {
      const perCounty = await Promise.all(selectedCounties.map((county) => getOwnedParcels(state, county)));
      return perCounty.flat();
    },
    enabled: state !== '' && selectedCounties.length > 0,
  });

  const rows = useMemo(() => buildExclusionRows(parcels.data ?? []), [parcels.data]);
  const headers = [...EXCLUSION_HEADERS];

  const history = useQuery({
    queryKey: ['exclusion-exports'],
    queryFn: () => listExclusionExports(),
  });

  const record = useMutation({
    mutationFn: (input: { state: string; counties: string[]; parcelCount: number; filename: string }) =>
      recordExclusionExport(input),
    onSuccess: () => {
      setSaveWarning(null);
      void queryClient.invalidateQueries({ queryKey: ['exclusion-exports'] });
    },
    onError: (error) => setSaveWarning(error.message),
  });

  const chooseState = (value: string) => {
    setState(value);
    setSelectedCounties([]);
    setSaveWarning(null);
  };

  const toggleCounty = (county: string) => {
    setSelectedCounties((current) =>
      current.includes(county) ? current.filter((c) => c !== county) : [...current, county],
    );
  };

  const download = () => {
    const now = new Date();
    const label = marketLabel(selectedCounties);
    const filename = exclusionFilename(state, label, now);
    downloadCsv(filename, toCsv(headers, rows));
    const iso = now.toISOString();
    writeLastGenerated(iso);
    setLastGenerated(iso);
    // Record the export after the download, so a file is never lost because the history save failed.
    record.mutate({ state, counties: [...selectedCounties].sort(), parcelCount: rows.length, filename });
  };

  const hasSelection = state !== '' && selectedCounties.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Check Before Buying' }]}
        title="Check Before Buying"
        description="Before you buy new data, download the parcels you already own. Upload that file to Land Portal so it leaves them out of the purchase."
      />

      <section aria-label="Choose a market" className="card space-y-4 p-5">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <label className="flex max-w-xs flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            State
            <SearchableSelect ariaLabel="State" placeholder="Choose a state" options={states} value={state} onChange={chooseState} />
          </label>
          <button
            type="button"
            className="btn-primary h-10"
            onClick={download}
            disabled={!hasSelection || parcels.isPending || rows.length === 0 || record.isPending}
          >
            <Download size={16} aria-hidden="true" /> Download exclusion file
          </button>
        </div>

        <fieldset disabled={!state}>
          <legend className="mb-2 flex w-full items-center justify-between text-xs font-medium text-muted-foreground">
            <span>Counties ({selectedCounties.length} selected)</span>
            {state && (
              <span className="flex gap-3">
                <button type="button" className="text-primary hover:underline" onClick={() => setSelectedCounties(counties)}>
                  Select all
                </button>
                <button type="button" className="text-primary hover:underline" onClick={() => setSelectedCounties([])}>
                  Clear
                </button>
              </span>
            )}
          </legend>
          {state === '' ? (
            <p className="text-sm text-muted-foreground">Choose a state to see its counties.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {counties.map((county) => (
                <label key={county} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedCounties.includes(county)}
                    onChange={() => toggleCounty(county)}
                    className="h-4 w-4 accent-primary"
                  />
                  {county}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </section>

      {options.isError && <ErrorState message="Markets could not be loaded." onRetry={() => options.refetch()} />}
      {parcels.isError && (
        <ErrorState message="Owned parcels could not be loaded for these counties." onRetry={() => parcels.refetch()} />
      )}

      {!hasSelection && (
        <div className="card">
          <EmptyState title="Choose a state and counties" description="The exclusion file lists every parcel you already own in the counties you pick." />
        </div>
      )}

      {hasSelection && !parcels.isError && (
        <>
          <section aria-label="Exclusion summary" className="grid gap-4 sm:grid-cols-3">
            <div className="card p-5">
              <div className="text-sm font-medium text-muted-foreground">Already owned in {marketLabel(selectedCounties)}</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums" aria-live="polite">
                {parcels.isPending ? '…' : formatCount(rows.length)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Parcels to leave out of the next purchase</div>
            </div>
            <div className="card p-5">
              <div className="text-sm font-medium text-muted-foreground">Last generated</div>
              <div className="mt-1 text-lg font-semibold">{lastGenerated ? formatTime(lastGenerated) : 'Not yet'}</div>
              <div className="mt-1 text-xs text-muted-foreground">Recorded on this browser</div>
            </div>
            <div className="card flex items-start gap-3 p-5">
              <ShieldCheck size={20} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                The file uses the columns {headers.join(', ')}. Confirm it against a Land Portal exclusion sample before uploading.
              </p>
            </div>
          </section>

          {saveWarning && (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              {saveWarning}
            </p>
          )}

          <div className="card overflow-hidden">
            <div className="border-b border-border px-4 py-3 text-sm font-medium">Preview</div>
            <DataTable<string[]>
              caption="Exclusion file preview"
              isLoading={parcels.isPending}
              rows={rows}
              rowKey={(r) => r.join('|')}
              defaultPageSize={25}
              searchPlaceholder="Search APN or county"
              columns={headers.map((header, index) => ({
                key: header,
                header,
                cell: (row: string[]) => <span className={index === 2 ? 'font-mono text-xs' : ''}>{row[index]}</span>,
                sortValue: (row: string[]) => row[index],
                searchValue: (row: string[]) => row[index],
              }))}
              empty={<EmptyState title="No owned parcels here" description="You don't own any parcels in these counties yet, so the file would be empty." />}
            />
          </div>
        </>
      )}

      <section aria-labelledby="export-history-heading" className="card overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h2 id="export-history-heading" className="text-sm font-semibold">
            Export history
          </h2>
          <p className="text-xs text-muted-foreground">Every exclusion file generated, newest first. Records cannot be edited or removed.</p>
        </div>
        {history.isError ? (
          <div className="p-4">
            <ErrorState message="Export history could not be loaded." onRetry={() => history.refetch()} />
          </div>
        ) : (
          <DataTable<ExclusionExportRecord>
            caption="Exclusion export history"
            isLoading={history.isPending}
            rows={history.data ?? []}
            rowKey={(e) => e.id}
            columns={HISTORY_COLUMNS}
            defaultSort={{ key: 'created', dir: 'desc' }}
            defaultPageSize={10}
            searchPlaceholder="Search history"
            empty={<EmptyState title="No exclusion files yet" description="Each file you download appears here." />}
          />
        )}
      </section>
    </div>
  );
}
