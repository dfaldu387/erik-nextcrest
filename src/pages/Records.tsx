import { Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusChip, statusConfig } from '@/components/ui/StatusChip';
import { ExportDialog, type ExportColumn } from '@/components/ui/ExportDialog';
import { usePropertiesQuery, usePropertyFilterOptionsQuery, usePropertyLabelsQuery, useInboxFilterOptionsQuery } from '@/hooks/useNextCrestData';
import { useAccountScope } from '@/lib/accountScope';
import { downloadCsv, toCsv } from '@/lib/csv';
import type { LandRecord, MarketingStatus } from '@/data/types';
import { daysSince, formatAcres, formatDate } from '@/lib/format';
import { exportProperties, getPropertyLabels, type PropertySort } from '@/services/nextcrestData';

const PROPERTY_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'apn', label: 'APN' },
  { key: 'owner', label: 'Owner' },
  { key: 'phone', label: 'Phone' },
  { key: 'county', label: 'County' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'ZIP' },
  { key: 'acres', label: 'Acres' },
  { key: 'status', label: 'Status' },
  { key: 'times', label: 'Times contacted' },
  { key: 'last', label: 'Last contacted' },
  { key: 'labels', label: 'Labels' },
];

function exportValue(r: LandRecord, key: string, labels: string[]): string | number {
  switch (key) {
    case 'apn': return r.apn;
    case 'owner': return r.ownerName;
    case 'phone': return r.phone;
    case 'county': return r.county;
    case 'state': return r.state;
    case 'zip': return r.zip;
    case 'acres': return r.acres;
    case 'status': return statusConfig[r.status]?.label ?? r.status;
    case 'times': return r.timesContacted;
    case 'last': return r.lastContactedAt ?? '';
    case 'labels': return labels.join('; ');
    default: return '';
  }
}

const STATUS_OPTIONS = Object.keys(statusConfig) as MarketingStatus[];
const SORT_KEYS: PropertySort[] = ['apn', 'owner', 'county', 'acres', 'status', 'times', 'last'];
const PAGE_SIZES = [10, 25, 50, 100];

// Waits for typing to pause so each keystroke does not send a database request.
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function Records() {
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<LandRecord | null>(null);

  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const state = params.get('state') ?? '';
  const county = params.get('county') ?? '';
  // The ZIP list is kept in the URL as a comma-separated value, e.g. zip=32066,32068.
  const zip = params.get('zip') ?? '';
  const zips = zip ? zip.split(',').filter(Boolean) : [];
  const sortParam = params.get('sort') ?? '';
  const sortKey: PropertySort = (SORT_KEYS as string[]).includes(sortParam) ? (sortParam as PropertySort) : 'owner';
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sizeParam = Number(params.get('size'));
  const pageSize = PAGE_SIZES.includes(sizeParam) ? sizeParam : 25;

  const debouncedQ = useDebouncedValue(q, 300);
  const { accountId } = useAccountScope();
  const { data, isPending, isError, refetch } = usePropertiesQuery({
    search: debouncedQ,
    status,
    state,
    county,
    zips,
    sort: sortKey,
    dir,
    page,
    pageSize,
    accountId,
  });
  const options = usePropertyFilterOptionsQuery();

  // Changes several URL parameters at once. Changing a filter, search, sort or page size goes back to page 1.
  const update = (changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  const places = options.data?.places ?? [];
  const states = [...new Set(places.map((p) => p.state))].sort();
  const counties = [...new Set(places.filter((p) => !state || p.state === state).map((p) => p.county))].sort();

  // ZIP codes in the chosen state and county, from the database.
  const zipOptions = [
    ...new Set(
      (options.data?.zips ?? [])
        .filter((p) => (!state || p.state === state) && (!county || p.county === county))
        .map((p) => p.zip),
    ),
  ].sort();

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const labelsQuery = usePropertyLabelsQuery(rows.map((r) => r.id));
  const labelsByProperty = labelsQuery.data ?? {};
  const labelOptions = useInboxFilterOptionsQuery();
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Exports the properties matching the filters on this page, then keeps those with any chosen label.
  const runExport = async ({ columns, labels }: { columns: string[]; labels: string[] }) => {
    setExportBusy(true);
    setExportError(null);
    try {
      const records = await exportProperties({ search: debouncedQ.trim(), status, state, county, zips, sort: sortKey, dir, accountId });
      const labelMap = await getPropertyLabels(records.map((r) => r.id));
      const wanted = new Set(labels);
      const kept = records.filter((r) => wanted.size === 0 || (labelMap[r.id] ?? []).some((name) => wanted.has(name)));
      const headers = columns.map((key) => PROPERTY_EXPORT_COLUMNS.find((c) => c.key === key)?.label ?? key);
      const body = kept.map((r) => columns.map((key) => exportValue(r, key, labelMap[r.id] ?? [])));
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`Properties_${stamp}.csv`, toCsv(headers, body));
      setExportOpen(false);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setExportBusy(false);
    }
  };
  const allProperties = options.data?.total ?? total;

  const activeFilters: { key: string; label: string }[] = [
    q && { key: 'q', label: `Search: “${q}”` },
    status && { key: 'status', label: `Status: ${statusConfig[status as MarketingStatus]?.label ?? status}` },
    state && { key: 'state', label: `State: ${state}` },
    county && { key: 'county', label: `County: ${county}` },
    zips.length > 0 && { key: 'zip', label: `ZIP: ${zips.join(', ')}` },
  ].filter(Boolean) as { key: string; label: string }[];

  const clearFilters = () => setParams({}, { replace: true });

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Properties' }]}
        title="Properties"
        description="Every property you own. Identified by APN, state and county, since most land has no street address."
        actions={
          <button type="button" className="btn-secondary h-9 px-3" disabled={total === 0} onClick={() => setExportOpen(true)}>
            Export CSV
          </button>
        }
      />
      {exportOpen && (
        <ExportDialog
          title="Export properties"
          description={`Exports the ${total.toLocaleString('en-US')} properties that match the filters on this page. Choose labels to keep only those properties.`}
          columns={PROPERTY_EXPORT_COLUMNS}
          labelOptions={labelOptions.data?.labels ?? []}
          busy={exportBusy}
          error={exportError}
          onClose={() => setExportOpen(false)}
          onExport={runExport}
        />
      )}

      <div className="card space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            Search
            <input
              type="search"
              value={q}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="APN, owner, county or phone"
              className="field"
            />
          </label>
          <div className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            <span>Marketing status</span>
            <SearchableSelect
              ariaLabel="Marketing status"
              placeholder="All statuses"
              options={STATUS_OPTIONS.map((key) => ({ value: key, label: statusConfig[key].label }))}
              value={status}
              onChange={(v) => update({ status: v })}
            />
          </div>
          <div className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            <span>State</span>
            <SearchableSelect ariaLabel="State" placeholder="All states" options={states} value={state} onChange={(v) => update({ state: v, county: null })} />
          </div>
          <div className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            <span>County</span>
            <SearchableSelect ariaLabel="County" placeholder="All counties" options={counties} value={county} onChange={(v) => update({ county: v })} />
          </div>
          <div className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            <span>ZIP code</span>
            <SearchableMultiSelect
              ariaLabel="ZIP code"
              placeholder="Any ZIP code"
              options={zipOptions}
              value={zips}
              onChange={(v) => update({ zip: v.join(',') })}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            {activeFilters.length === 0 ? (
              <span className="text-xs text-muted-foreground">No filters applied</span>
            ) : (
              activeFilters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => update({ [f.key]: null, ...(f.key === 'state' ? { county: null } : {}) })}
                  className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:opacity-80"
                >
                  {f.label}
                  <X size={12} aria-label={`Remove ${f.label}`} />
                </button>
              ))
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {isPending
                ? 'Loading…'
                : `${total.toLocaleString('en-US')} of ${allProperties.toLocaleString('en-US')} records`}
            </span>
            {activeFilters.length > 0 && (
              <button type="button" className="btn-ghost h-8 px-2 text-xs" onClick={clearFilters}>
                Clear all
              </button>
            )}
          </div>
        </div>
      </div>

      {isError ? (
        <ErrorState message="Records could not be loaded." onRetry={() => refetch()} />
      ) : (
        <div className="card overflow-hidden">
          <DataTable<LandRecord>
            caption="Property records"
            isLoading={isPending}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelected(r)}
            server={{
              total,
              page,
              pageSize,
              sort: { key: sortKey, dir },
              onPageChange: (next) => update({ page: next > 1 ? String(next) : null }, false),
              onPageSizeChange: (size) => update({ size: String(size) }),
              onSortChange: (next) => update({ sort: next.key, dir: next.dir }),
            }}
            empty={
              <EmptyState
                title="No records match these filters"
                description="Try removing a filter or searching for a different APN or owner."
                action={
                  activeFilters.length > 0 ? (
                    <button type="button" className="btn-secondary" onClick={clearFilters}>
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            }
            columns={[
              {
                key: 'owner',
                header: 'Owner',
                sortValue: (r) => r.ownerName,
                cell: (r) => (
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.ownerName}</div>
                    <div className="text-xs text-muted-foreground">{r.ownerType}</div>
                  </div>
                ),
              },
              {
                key: 'apn',
                header: 'APN',
                sortValue: (r) => r.apn,
                cell: (r) => <span className="whitespace-nowrap font-mono text-xs">{r.apn}</span>,
                hideBelow: 'md',
              },
              {
                key: 'county',
                header: 'County · State',
                sortValue: (r) => `${r.state} ${r.county}`,
                cell: (r) => `${r.county}, ${r.state}`,
                hideBelow: 'lg',
              },
              { key: 'acres', header: 'Acres', sortValue: (r) => r.acres, cell: (r) => formatAcres(r.acres), hideBelow: 'lg' },
              { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusChip status={r.status} /> },
              {
                key: 'labels',
                header: 'Labels',
                cell: (r) => {
                  const names = labelsByProperty[r.id] ?? [];
                  if (names.length === 0) return <span className="text-muted-foreground">—</span>;
                  return (
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {names.map((name) => (
                        <span key={name} className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">{name}</span>
                      ))}
                    </div>
                  );
                },
              },
              {
                key: 'times',
                header: 'Times contacted',
                sortValue: (r) => r.timesContacted,
                cell: (r) => <span className="tabular-nums">{r.timesContacted}</span>,
                className: 'text-center',
              },
              {
                key: 'last',
                header: 'Last contacted',
                sortValue: (r) => r.lastContactedAt,
                cell: (r) => {
                  const days = daysSince(r.lastContactedAt);
                  return (
                    <span className="text-xs text-muted-foreground">
                      {days === null ? 'Never' : `${formatDate(r.lastContactedAt)} (${days}d ago)`}
                    </span>
                  );
                },
                hideBelow: 'md',
              },
              {
                key: 'action',
                header: 'Action',
                cell: (r) => (
                  <Link
                    to={`/properties/${r.id}`}
                    aria-label={`Open property ${r.apn}`}
                    title="Open property"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-primary hover:bg-muted"
                  >
                    <Send size={16} aria-hidden="true" />
                  </Link>
                ),
                className: 'text-center',
              },
            ]}
          />
        </div>
      )}

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.ownerName ?? ''}
        subtitle={selected ? `APN ${selected.apn} · ${selected.county}, ${selected.state}` : undefined}
      >
        {selected && <RecordDetail record={selected} />}
      </Drawer>
    </div>
  );
}

function RecordDetail({ record }: { record: LandRecord }) {
  const rows: [string, string][] = [
    ['Owner type', record.ownerType],
    ['APN / parcel ID', record.apn],
    ['County', `${record.county}, ${record.state} ${record.zip}`],
    ['Acres', formatAcres(record.acres)],
    ['Phone on file', record.phone],
    ['Acquired', formatDate(record.acquiredAt)],
    ['Assigned to', record.assignedTo ?? 'Unassigned'],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <StatusChip status={record.status} />
        <Link to={`/properties/${record.id}`} className="text-sm font-medium text-primary hover:underline">
          Open full property page
        </Link>
      </div>

      <dl className="divide-y divide-border rounded-md border border-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="contact-summary">
        <h3 id="contact-summary" className="mb-2 text-sm font-semibold">
          Contact summary
        </h3>
        <p className="text-sm text-muted-foreground">
          {record.timesContacted === 0
            ? 'No text has been sent to this owner yet.'
            : `Texted ${record.timesContacted} time${record.timesContacted === 1 ? '' : 's'}, last on ${formatDate(record.lastContactedAt)}. ${record.responded ? 'The owner has replied.' : 'No reply recorded.'}`}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          A message-by-message timeline appears once SmarterContact history is connected.
        </p>
      </section>

      <section aria-labelledby="actions-heading">
        <h3 id="actions-heading" className="mb-2 text-sm font-semibold">
          Actions
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {['Mark wrong number', 'Mark purchased', 'Add note', 'Assign'].map((label) => (
            <button key={label} type="button" className="btn-secondary" disabled title="Available once the database is connected">
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
