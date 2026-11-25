import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Download, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { CommitPanel } from '@/components/import/CommitPanel';
import { SavedFiltersBar } from '@/components/purchase/SavedFiltersBar';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { useAuth } from '@/lib/auth';
import { parseCsv } from '@/lib/csv';
import { buildOwnedIndex } from '@/lib/duplicates';
import { formatCount } from '@/lib/format';
import { autoMap } from '@/lib/autoMap';
import { createExport, filterProperties, getFilterValues, getExportStatus, LandPortalError } from '@/lib/landportal';
import type { LandPortalExportStatus } from '@/lib/landportal';
import { isMappingComplete } from '@/lib/importMapping';
import { reviewBatch, summarizeBatch } from '@/lib/importReview';
import type { BatchFile, ReviewRow } from '@/lib/importReview';
import { buildSearchFilters, countiesFromFips, landUseFromFlat, STATE_CODES, valuesFor, vacancySources } from '@/lib/landportalFilters';
import {
  criteriaToForm,
  EMPTY_FORM,
  formToCriteria,
  formToPanel,
  type FilterForm,
} from '@/lib/savedFilters';
import {
  exportRequest,
  ownedKeysFrom,
  ownedRecordsFrom,
  splitByOwned,
  toSearchResults,
  type SearchResult,
} from '@/lib/purchaseFlow';
import {
  deleteSavedFilter,
  getOwnedParcels,
  listSavedFilters,
  saveFilter,
  type SavedFilterRecord,
} from '@/services/nextcrestData';

const TERMINAL: LandPortalExportStatus['status'][] = ['completed', 'failed', 'stopped'];

interface Place {
  fips: string;
  state: string; // two-letter code, as stored in our records
  stateName: string;
  county: string;
}

interface SearchOutcome {
  fresh: SearchResult[];
  owned: SearchResult[];
  ownedKeys: Set<string>;
  total: number;
  countyNames: Record<string, string>;
}

// Filter panel, saved filter sets, and results for Land Portal. Matches are checked against the parcels
// already in our records, and only new parcels can be exported.
export function SearchAndBuy() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const userId = auth.status === 'signed-in' ? auth.session.user.id : null;

  const lpValues = useQuery({
    queryKey: ['landportal-filter-values'],
    queryFn: async () => {
      const [fips, landUse, vacancy] = await Promise.all([
        getFilterValues('fips'),
        getFilterValues('landusecode'),
        getFilterValues('vacantflag'),
      ]);
      return { fips: countiesFromFips(fips.data.fips), landUse: landUseFromFlat(landUse.data.landusecode), vacancy: vacancySources(vacancy.data) };
    },
    staleTime: 60 * 60_000,
  });

  const places = useMemo<Place[]>(() => {
    const out: Place[] = [];
    for (const [stateName, counties] of Object.entries(lpValues.data?.fips ?? {})) {
      const code = STATE_CODES[stateName];
      if (!code) continue;
      for (const [fips, county] of Object.entries(counties)) out.push({ fips, state: code, stateName, county });
    }
    return out;
  }, [lpValues.data]);
  const placeByFips = useMemo(() => new Map(places.map((p) => [p.fips, p])), [places]);
  const stateNames = useMemo(() => [...new Set(places.map((p) => p.stateName))].sort(), [places]);

  const [form, setForm] = useState<FilterForm>(EMPTY_FORM);
  const [countyFilter, setCountyFilter] = useState('');
  const [landUseFilter, setLandUseFilter] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [taskId, setTaskId] = useState<string | null>(null);
  const [tokensLeft, setTokensLeft] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Saved filters
  const saved = useQuery({ queryKey: ['saved-filters'], queryFn: listSavedFilters });
  const [saveMessage, setSaveMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [loadedName, setLoadedName] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (name: string) => saveFilter(name, formToCriteria(form)),
    onSuccess: (_data, name) => {
      setSaveMessage({ tone: 'ok', text: `Saved “${name.trim()}”.` });
      setLoadedName(name.trim());
      void queryClient.invalidateQueries({ queryKey: ['saved-filters'] });
    },
    onError: (error) => setSaveMessage({ tone: 'error', text: error instanceof Error ? error.message : 'The filter could not be saved.' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSavedFilter(id),
    onSuccess: () => {
      setSaveMessage({ tone: 'ok', text: 'Filter deleted.' });
      void queryClient.invalidateQueries({ queryKey: ['saved-filters'] });
    },
    onError: (error) => setSaveMessage({ tone: 'error', text: error instanceof Error ? error.message : 'The filter could not be deleted.' }),
  });

  const loadFilter = (record: SavedFilterRecord) => {
    setForm(criteriaToForm(record.criteria));
    setLoadedName(record.name);
    setSaveMessage({ tone: 'ok', text: `Loaded “${record.name}”.` });
    setFormError(null);
  };

  // Cities and ZIP codes that exist in the selected counties. Land Portal returns them per county.
  const placeKey = [...form.fips].sort().join('|');
  const placeValues = useQuery({
    queryKey: ['landportal-place-values', placeKey],
    enabled: form.fips.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const perCounty = await Promise.all(
        form.fips.map(async (fips) => {
          const [cities, zips] = await Promise.all([getFilterValues('situscity', fips), getFilterValues('situszip5', fips)]);
          return { cities: valuesFor(cities.data, 'situscity'), zips: valuesFor(zips.data, 'situszip5') };
        }),
      );
      return {
        cities: [...new Set(perCounty.flatMap((p) => p.cities))].sort(),
        zips: [...new Set(perCounty.flatMap((p) => p.zips))].sort(),
      };
    },
  });

  const countiesInState = useMemo(
    () => places.filter((p) => p.stateName === form.stateName && p.county.toLowerCase().includes(countyFilter.trim().toLowerCase())),
    [places, form.stateName, countyFilter],
  );

  const search = useMutation<SearchOutcome, Error, FilterForm>({
    mutationFn: async (input) => {
      const panel = formToPanel(input);
      const result = await withRetry(() => filterProperties({ filters: buildSearchFilters(panel) }));
      const results = toSearchResults(result.data.properties);

      const chosen = panel.fips.map((f) => placeByFips.get(f)).filter((p): p is Place => !!p);
      const unique = [...new Map(chosen.map((p) => [`${p.state}|${p.county}`, p])).values()];
      const parcelSets = await Promise.all(unique.map((p) => getOwnedParcels(p.state, p.county)));
      const ownedKeys = ownedKeysFrom(parcelSets.flat());

      const { fresh, owned } = splitByOwned(results, ownedKeys, (fips) => {
        const p = placeByFips.get(fips);
        return p ? { state: p.state, county: p.county } : null;
      });
      const countyNames = Object.fromEntries(results.map((r) => [r.fips, placeByFips.get(r.fips)?.county ?? r.fips]));
      return { fresh, owned, ownedKeys, total: results.length, countyNames };
    },
    onSuccess: (outcome) => {
      setSelected(new Set(outcome.fresh.map((r) => r.propertyId)));
      setTaskId(null);
      setExportError(null);
    },
  });

  const outcome = search.data;

  const submit = () => {
    // Keep only cities and ZIP codes that exist in the selected counties.
    const valid = placeValues.data;
    const scoped: FilterForm = valid
      ? { ...form, cities: form.cities.filter((c) => valid.cities.includes(c)), zips: form.zips.filter((z) => valid.zips.includes(z)) }
      : form;
    try {
      buildSearchFilters(formToPanel(scoped));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Check the search.');
      return;
    }
    setFormError(null);
    search.mutate(scoped);
  };

  const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const set = <K extends keyof FilterForm>(key: K, value: FilterForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = useMemo(() => (outcome ? outcome.fresh.filter((r) => selected.has(r.propertyId)) : []), [outcome, selected]);

  const startExport = useMutation({
    mutationFn: async () => {
      const req = exportRequest(chosen);
      return createExport(req.fips, req.propertyid);
    },
    onSuccess: (res) => {
      setTaskId(res.data.task_id);
      setTokensLeft(res.data.export_tokens_left);
      setExportError(null);
    },
    onError: (error) => setExportError(error instanceof LandPortalError ? error.message : 'The export could not be started.'),
  });

  const status = useQuery({
    queryKey: ['landportal-export', taskId],
    queryFn: async () => (await getExportStatus(taskId as string)).data,
    enabled: taskId !== null,
    refetchInterval: (query) => {
      const data = query.state.data as LandPortalExportStatus | undefined;
      return data && TERMINAL.includes(data.status) ? false : 5000;
    },
  });

  const exportDone = status.data?.status === 'completed' && !!status.data.file_url;

  const download = useQuery({
    queryKey: ['landportal-export-file', taskId],
    queryFn: async () => {
      const response = await fetch(status.data?.file_url as string);
      if (!response.ok) throw new Error(`The export file could not be downloaded (HTTP ${response.status}).`);
      return response.text();
    },
    enabled: exportDone,
    retry: false,
  });

  const batch = useMemo<{ files: BatchFile[]; reviewed: ReviewRow[]; mappingOk: boolean } | null>(() => {
    if (!download.data || !outcome) return null;
    const table = parseCsv(download.data);
    if (table.length < 2) return { files: [], reviewed: [], mappingOk: false };
    const mapping = autoMap(table[0], table.slice(1)).mapping;
    const files: BatchFile[] = [{ name: `landportal-export-${taskId}.csv`, table, mapping }];
    const owned = buildOwnedIndex(ownedRecordsFrom([...outcome.ownedKeys].map(parseKey)));
    return { files, reviewed: reviewBatch(files, owned), mappingOk: isMappingComplete(mapping) };
  }, [download.data, outcome, taskId]);

  const isRunning = taskId !== null && !(status.data && TERMINAL.includes(status.data.status));
  const selectedCounties = form.fips.length;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Search & Buy' }]}
        title="Search & Buy"
        description="Filter Land Portal, see which matches you already own, and export only the new parcels. The export goes through the same review and save steps as an import."
      />

      {lpValues.isError && (
        <ErrorState message="Land Portal's county list could not be loaded. Check that the development server is running." onRetry={() => lpValues.refetch()} />
      )}

      <SavedFiltersBar
        records={saved.data ?? []}
        loading={saved.isPending}
        error={saved.isError ? "Saved filters could not be loaded." : null}
        userId={userId}
        loadedName={loadedName}
        saving={saveMutation.isPending}
        deleting={deleteMutation.isPending}
        message={saveMessage}
        onLoad={loadFilter}
        onSave={(name) => saveMutation.mutate(name)}
        onDelete={(record) => deleteMutation.mutate(record.id)}
      />

      <section aria-labelledby="filter-heading" className="card space-y-5 p-5">
        <h2 id="filter-heading" className="text-sm font-semibold">Filtered search</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            State
            <SearchableSelect
              ariaLabel="State"
              value={form.stateName}
              onChange={(v) => {
                setForm((f) => ({ ...f, stateName: v, fips: [], cities: [], zips: [] }));
                setCountyFilter('');
              }}
              options={stateNames}
              placeholder="Choose a state"
              disabled={!lpValues.data}
            />
          </label>
          <div className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            <span>Counties ({selectedCounties} selected)</span>
            <input
              type="search"
              value={countyFilter}
              onChange={(e) => setCountyFilter(e.target.value)}
              placeholder="Search counties"
              aria-label="Search counties"
              className="field"
              disabled={!form.stateName}
            />
          </div>
        </div>

        {form.stateName && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{countyFilter.trim() ? 'Counties shown' : 'All counties in the state'}</span>
            <div className="flex gap-3">
              <button
                type="button"
                className="font-medium text-brand hover:underline"
                onClick={() => set('fips', [...new Set([...form.fips, ...countiesInState.map((p) => p.fips)])])}
              >
                Select all{countyFilter.trim() ? ' shown' : ''}
              </button>
              <button type="button" className="font-medium text-muted-foreground hover:underline" onClick={() => set('fips', [])}>
                Clear
              </button>
            </div>
          </div>
        )}
        {form.stateName && (
          <div className="grid max-h-48 gap-2 overflow-y-auto rounded-[10px] border border-border p-3 sm:grid-cols-2 xl:grid-cols-3" role="group" aria-label="Counties">
            {countiesInState.map((p) => (
              <label key={p.fips} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.fips.includes(p.fips)} onChange={() => set('fips', toggleIn(form.fips, p.fips))} className="h-4 w-4 accent-primary" />
                {p.county} <span className="font-mono text-[11px] text-muted-foreground">{p.fips}</span>
              </label>
            ))}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <ValuePicker
            label="Parcel address city"
            options={placeValues.data?.cities ?? []}
            selected={form.cities}
            onChange={(v) => set('cities', v)}
            disabled={form.fips.length === 0}
            loading={placeValues.isFetching}
            emptyText="Choose a county first"
          />
          <ValuePicker
            label="Parcel address ZIP code"
            options={placeValues.data?.zips ?? []}
            selected={form.zips}
            onChange={(v) => set('zips', v)}
            disabled={form.fips.length === 0}
            loading={placeValues.isFetching}
            emptyText="Choose a county first"
          />
        </div>

        <fieldset className="space-y-3 rounded-[10px] border border-border p-4">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Property type</legend>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={form.vacantLots} onChange={(e) => set('vacantLots', e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
            <span>
              <span className="font-medium">Vacant lots</span>
              <span className="block text-xs text-muted-foreground">Properties with no structures identified by AI</span>
            </span>
          </label>
          <div className="space-y-2">
            <p className="text-sm font-medium">Vacant structures</p>
            <p className="text-xs text-muted-foreground">Identifies if the property is vacant. Choose the sources to match.</p>
            <div className="flex flex-wrap gap-3">
              {(lpValues.data?.vacancy ?? []).map((v) => (
                <label key={v.code} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={form.vacantSources.includes(v.code)} onChange={() => set('vacantSources', toggleIn(form.vacantSources, v.code))} className="h-4 w-4 accent-primary" />
                  {v.label}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={form.residential} onChange={(e) => set('residential', e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
            <span>
              <span className="font-medium">Residential properties</span>
              <span className="block text-xs text-muted-foreground">Limit to the residential land-use codes you pick below</span>
            </span>
          </label>
          {form.residential && (
            <div className="space-y-2">
              <input type="search" value={landUseFilter} onChange={(e) => setLandUseFilter(e.target.value)} placeholder="Search land-use codes" aria-label="Search land-use codes" className="field" />
              <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2" role="group" aria-label="Land-use codes">
                {(lpValues.data?.landUse ?? []).map((group) => {
                  const matches = group.codes.filter((c) => `${c.code} ${c.label}`.toLowerCase().includes(landUseFilter.trim().toLowerCase()));
                  if (matches.length === 0) return null;
                  return (
                    <div key={group.category}>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.category}</p>
                      {matches.map((c) => (
                        <label key={c.code} className="flex items-center gap-2 py-0.5 text-xs">
                          <input type="checkbox" checked={form.landUseCodes.includes(c.code)} onChange={() => set('landUseCodes', toggleIn(form.landUseCodes, c.code))} className="h-4 w-4 accent-primary" />
                          <span className="font-mono text-[11px]">{c.code}</span> {c.label}
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Acres (min – max)">
            <div className="flex items-center gap-2">
              <input value={form.acresMin} onChange={(e) => set('acresMin', e.target.value)} inputMode="decimal" placeholder="Min" aria-label="Minimum acres" className="field" />
              <span className="text-muted-foreground">–</span>
              <input value={form.acresMax} onChange={(e) => set('acresMax', e.target.value)} inputMode="decimal" placeholder="Max" aria-label="Maximum acres" className="field" />
            </div>
          </Field>
          <Field label="Lot sqft (min – max)">
            <div className="flex items-center gap-2">
              <input value={form.sqftMin} onChange={(e) => set('sqftMin', e.target.value)} inputMode="numeric" placeholder="Min" aria-label="Minimum lot square feet" className="field" />
              <span className="text-muted-foreground">–</span>
              <input value={form.sqftMax} onChange={(e) => set('sqftMax', e.target.value)} inputMode="numeric" placeholder="Max" aria-label="Maximum lot square feet" className="field" />
            </div>
          </Field>
        </div>

        {formError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{formError}</p>}
        {search.isError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{search.error.message}</p>}

        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn-secondary h-9" onClick={() => { setForm(EMPTY_FORM); setFormError(null); }}>
            Reset
          </button>
          <button type="button" className="btn-primary h-9" onClick={submit} disabled={search.isPending || !lpValues.data}>
            <Search size={15} aria-hidden="true" /> {search.isPending ? 'Searching…' : 'Search Land Portal'}
          </button>
        </div>
      </section>

      {!outcome && !search.isPending && (
        <div className="card">
          <EmptyState title="Set your filters and search" description="Results show which matches you already own, so only new parcels are exported." />
        </div>
      )}

      {outcome && (
        <>
          {outcome.total === 0 && (
            <div className="card">
              <EmptyState
                title="No parcels match these filters"
                description="Land Portal returned no parcels for this search. Try removing a vacancy source or a land-use code, or widen the acre or lot-size range."
              />
            </div>
          )}
          <section aria-label="Search summary" className="grid gap-4 sm:grid-cols-3">
            <Stat label="Matches in Land Portal" value={formatCount(outcome.total)} />
            <Stat label="Already owned (not exported)" value={formatCount(outcome.owned.length)} />
            <Stat label="New (can be exported)" value={formatCount(outcome.fresh.length)} />
          </section>

          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold">New parcels · {formatCount(chosen.length)} selected</p>
                <p className="text-xs text-muted-foreground">Exporting uses one Land Portal export token per selected parcel.</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-secondary h-8" onClick={() => setSelected(new Set(outcome.fresh.map((r) => r.propertyId)))}>Select all</button>
                <button type="button" className="btn-secondary h-8" onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            </div>
            {outcome.fresh.length === 0 ? (
              <div className="p-4"><EmptyState tone="success" title="Nothing new" description="Every match in this search is already in your records." /></div>
            ) : (
              <div className="max-h-96 overflow-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <caption className="sr-only">New parcels from Land Portal</caption>
                  <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-12 px-4 py-2"><span className="sr-only">Select</span></th>
                      <th scope="col" className="px-4 py-2 font-semibold">APN</th>
                      <th scope="col" className="px-4 py-2 font-semibold">County</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Owner</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Address</th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">Acres</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outcome.fresh.map((r) => (
                      <tr key={r.propertyId} className="border-t border-border hover:bg-muted/60">
                        <td className="px-4 py-2">
                          <input type="checkbox" checked={selected.has(r.propertyId)} onChange={() => toggleSelected(r.propertyId)} aria-label={`Select APN ${r.apn}`} className="h-4 w-4 accent-primary" />
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{r.apn || '—'}</td>
                        <td className="px-4 py-2">{outcome.countyNames[r.fips] ?? r.fips}</td>
                        <td className="px-4 py-2">{r.owner || '—'}</td>
                        <td className="px-4 py-2 text-muted-foreground">{r.address || '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.acres === null ? '—' : r.acres}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <section aria-labelledby="export-heading" className="card space-y-3 p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-brand" aria-hidden="true" />
              <h2 id="export-heading" className="text-sm font-semibold">Export the selected parcels</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              This spends {formatCount(chosen.length)} Land Portal export token{chosen.length === 1 ? '' : 's'}
              {tokensLeft !== null && <> · {formatCount(tokensLeft)} left after the last export</>}.
            </p>
            <button type="button" className="btn-primary h-9" disabled={chosen.length === 0 || startExport.isPending || isRunning} onClick={() => startExport.mutate()}>
              <Download size={15} aria-hidden="true" /> Approve and export {formatCount(chosen.length)} parcel{chosen.length === 1 ? '' : 's'}
            </button>
            {exportError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{exportError}</p>}
            {taskId !== null && (
              <p className="text-sm" aria-live="polite">
                Export #{taskId}: {status.data?.status ?? 'queued'}
                {status.data?.rows !== undefined && <> · {formatCount(status.data.rows)} rows</>}
                {status.data?.status === 'failed' && status.data.error_message && <> · {status.data.error_message}</>}
              </p>
            )}
            {status.isError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">The export status could not be read.</p>}
            {download.isError && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                {download.error instanceof Error ? download.error.message : 'The export file could not be downloaded.'} The file can still be downloaded from Land Portal and imported on the Data Import page.
              </p>
            )}
          </section>

          {batch && batch.files.length > 0 && (
            <>
              {!batch.mappingOk && (
                <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
                  Some columns in the export could not be matched automatically. Check the file on the Data Import page before saving.
                </p>
              )}
              <CommitPanel files={batch.files} reviewed={batch.reviewed} summary={summarizeBatch(batch.reviewed)} filename={batch.files[0].name} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// Land Portal occasionally fails a request without a reason. One retry clears most of these.
async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Owned keys are stored as "STATE|county|APN". Turns one back into a parcel for the review step.
function parseKey(key: string): { apn: string; state: string; county: string } {
  const [state, county, apn] = key.split('|');
  return { apn: apn ?? '', state: (state ?? '').toUpperCase(), county: county ?? '' };
}

// A dropdown of checkboxes with search. Selected values show as chips below the box.
function ValuePicker({
  label,
  options,
  selected,
  onChange,
  disabled,
  loading,
  emptyText,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  disabled: boolean;
  loading: boolean;
  emptyText: string;
}) {
  const [query, setQuery] = useState('');
  const shown = options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  const summary = disabled ? emptyText : loading && options.length === 0 ? 'Loading…' : selected.length > 0 ? `${selected.length} selected` : `Select ${label.toLowerCase()}`;

  return (
    <div className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <details className="relative">
        <summary
          aria-disabled={disabled}
          className={`field flex cursor-pointer list-none items-center justify-between gap-2 ${disabled ? 'pointer-events-none opacity-60' : ''}`}
        >
          <span className="truncate font-normal text-foreground">{summary}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="absolute z-20 mt-1 w-full rounded-[10px] border border-border bg-card p-2 shadow-shell">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            aria-label={`Search ${label.toLowerCase()}`}
            className="field mb-2 w-full"
          />
          <div className="mb-2 flex items-center justify-between text-[11px] font-normal">
            <button type="button" className="font-medium text-brand hover:underline" onClick={() => onChange([...new Set([...selected, ...shown])])} disabled={shown.length === 0}>
              Select all{query.trim() ? ' shown' : ''}
            </button>
            <button type="button" className="font-medium text-muted-foreground hover:underline" onClick={() => onChange([])} disabled={selected.length === 0}>
              Clear
            </button>
          </div>
          <ul className="max-h-56 overflow-y-auto" role="group" aria-label={label}>
            {shown.map((o) => (
              <li key={o}>
                <label className="flex items-center gap-2 py-1 text-sm font-normal text-foreground">
                  <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} className="h-4 w-4 accent-primary" />
                  {o}
                </label>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="px-1 py-2 text-xs font-normal text-muted-foreground">No matches.</p>}
        </div>
      </details>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              aria-label={`Remove ${v}`}
              className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-normal text-accent-foreground"
            >
              {v} ×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
