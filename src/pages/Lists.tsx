import { Download, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import { normalizeZip } from '@/lib/zip';
import { CardSkeleton, ErrorState } from '@/components/ui/States';
import { useRecordsQuery } from '@/hooks/useNextCrestData';
import { EXCLUSION_REASONS, SMARTERCONTACT_HEADERS, planCampaignExport, toSmarterContactRow } from '@/lib/campaignExport';
import { downloadCsv, toCsv } from '@/lib/csv';
import { applyListFilters, emptyFilters } from '@/lib/listFilters';
import type { ListFilters } from '@/lib/listFilters';
import { loadSavedLists, saveSavedLists } from '@/lib/savedLists';
import type { SavedList } from '@/lib/savedLists';
import { formatCount, formatDate } from '@/lib/format';
import { statusConfig } from '@/components/ui/StatusChip';
import type { MarketingStatus } from '@/data/types';

const inputClass = 'field w-full';

export function Lists() {
  const { data, isPending, isError, refetch } = useRecordsQuery();
  const [filters, setFilters] = useState<ListFilters>(emptyFilters);
  const [saved, setSaved] = useState<SavedList[]>(() => loadSavedLists());
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const records = useMemo(() => data?.data ?? [], [data]);
  const states = useMemo(() => [...new Set(records.map((r) => r.state))].sort(), [records]);
  const counties = useMemo(
    () => [...new Set(records.filter((r) => !filters.state || r.state === filters.state).map((r) => r.county))].sort(),
    [records, filters.state],
  );
  // ZIP codes that exist in the chosen state and county.
  const zipOptions = useMemo(
    () =>
      [
        ...new Set(
          records
            .filter((r) => (!filters.state || r.state === filters.state) && (!filters.county || r.county === filters.county))
            .map((r) => normalizeZip(r.zip))
            .filter(Boolean),
        ),
      ].sort(),
    [records, filters.state, filters.county],
  );
  const matches = useMemo(() => applyListFilters(records, filters), [records, filters]);
  const plan = useMemo(() => planCampaignExport(matches), [matches]);

  const update = <K extends keyof ListFilters>(key: K, value: ListFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value, ...(key === 'state' ? { county: '' } : {}) }));

  const onSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage('Enter a name for the list before saving.');
      return;
    }
    const next: SavedList[] = [
      { id: crypto.randomUUID(), name: trimmed, filters, createdAt: new Date().toISOString() },
      ...saved,
    ];
    setSaved(next);
    const stored = saveSavedLists(next);
    setName('');
    setMessage(stored ? `Saved “${trimmed}” in this browser.` : `Saved for this session only. Browser storage is unavailable.`);
  };

  const onDelete = (id: string) => {
    const next = saved.filter((l) => l.id !== id);
    setSaved(next);
    saveSavedLists(next);
  };

  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const scope = filters.county || filters.state || 'All';
    downloadCsv(`SmarterContact_${scope}_${stamp}.csv`, toCsv(SMARTERCONTACT_HEADERS, plan.included.map(toSmarterContactRow)));
  };

  if (isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Lists" description="Build a list, see what gets excluded, and export it." />
        <CardSkeleton rows={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Lists" description="Build a list, see what gets excluded, and export it." />
        <ErrorState message="Records could not be loaded for list building." onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Lists' }]}
        title="Lists"
        description="Filter the properties, check who is excluded and why, then export a campaign-ready file."
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="card space-y-4 p-5 xl:col-span-2" aria-labelledby="builder-heading">
          <h2 id="builder-heading" className="text-base font-semibold">
            Filters
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="State">
              <SearchableSelect ariaLabel="State" placeholder="All states" options={states} value={filters.state} onChange={(v) => update('state', v)} />
            </Field>
            <Field label="County">
              <SearchableSelect ariaLabel="County" placeholder="All counties" options={counties} value={filters.county} onChange={(v) => update('county', v)} />
            </Field>
            <Field label="ZIP code">
              <SearchableMultiSelect
                ariaLabel="ZIP code"
                placeholder="Any ZIP code"
                options={zipOptions}
                value={Array.isArray(filters.zip) ? filters.zip : []}
                onChange={(v) => update('zip', v)}
              />
            </Field>
            <Field label="Marketing status">
              <SearchableSelect
                ariaLabel="Marketing status"
                placeholder="Any status"
                options={(Object.keys(statusConfig) as MarketingStatus[]).map((key) => ({ value: key, label: statusConfig[key].label }))}
                value={filters.status}
                onChange={(v) => update('status', v)}
              />
            </Field>
            <Field label="Owner type">
              <SearchableSelect
                ariaLabel="Owner type"
                placeholder="Any owner"
                options={['Individual', 'LLC', 'Trust', 'Corporation']}
                value={filters.ownerType}
                onChange={(v) => update('ownerType', v)}
              />
            </Field>
            <Field label="Times texted (min)">
              <input className={inputClass} type="number" min={0} inputMode="numeric" value={filters.minContacts} onChange={(e) => update('minContacts', e.target.value)} />
            </Field>
            <Field label="Times texted (max)">
              <input className={inputClass} type="number" min={0} inputMode="numeric" value={filters.maxContacts} onChange={(e) => update('maxContacts', e.target.value)} />
            </Field>
            <Field label="Acres (min)">
              <input className={inputClass} type="number" min={0} inputMode="decimal" value={filters.minAcres} onChange={(e) => update('minAcres', e.target.value)} />
            </Field>
            <Field label="Acres (max)">
              <input className={inputClass} type="number" min={0} inputMode="decimal" value={filters.maxAcres} onChange={(e) => update('maxAcres', e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-ghost" onClick={() => setFilters(emptyFilters)}>
              Reset filters
            </button>
          </div>
        </section>

        <section className="card space-y-4 p-5" aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="text-base font-semibold">
            Export summary
          </h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Matching properties</dt>
              <dd className="text-xl font-semibold tabular-nums">{formatCount(plan.total)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Ready to export</dt>
              <dd className="text-xl font-semibold tabular-nums text-green-700 dark:text-green-300">{formatCount(plan.included.length)}</dd>
            </div>
          </dl>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Excluded</h3>
            <ul className="space-y-1.5 text-sm">
              {EXCLUSION_REASONS.map((reason) => (
                <li key={reason} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{reason}</span>
                  <span className="tabular-nums">{formatCount(plan.excluded[reason])}</span>
                </li>
              ))}
            </ul>
          </div>
          <button type="button" className="btn-primary w-full" onClick={exportCsv} disabled={plan.included.length === 0}>
            <Download size={16} aria-hidden="true" /> Export {formatCount(plan.included.length)} records
          </button>
        </section>
      </div>

      <section className="card space-y-4 p-5" aria-labelledby="save-heading">
        <h2 id="save-heading" className="text-base font-semibold">
          Save this list
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex-1">
            <span className="sr-only">List name</span>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bexar 10+ year owners" />
          </label>
          <button type="button" className="btn-secondary" onClick={onSave}>
            Save list
          </button>
        </div>
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}

        {saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved lists yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {saved.map((list) => (
              <li key={list.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <button type="button" className="truncate text-left font-medium text-primary hover:underline" onClick={() => setFilters(list.filters)}>
                    {list.name}
                  </button>
                  <p className="text-xs text-muted-foreground">Saved {formatDate(list.createdAt)} · filters are stored as data</p>
                </div>
                <button type="button" className="btn-ghost h-8 w-8 p-0" onClick={() => onDelete(list.id)} aria-label={`Delete ${list.name}`}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Saved lists are kept in this browser until the database is connected. Dynamic lists that refresh automatically come with it.
        </p>
      </section>
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
