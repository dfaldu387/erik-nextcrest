import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CitySearch } from '@/components/import/CitySearch';
import { ImportHistory } from '@/components/import/ImportHistory';
import { ImportWizard } from '@/components/import/ImportWizard';
import { SmarterContactHistory } from '@/components/import/SmarterContactHistory';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/States';
import { useRecordsQuery, useSuppressedPhonesQuery } from '@/hooks/useNextCrestData';
import { EXCLUSION_REASONS, SMARTERCONTACT_HEADERS, planCampaignExport, toSmarterContactRow } from '@/lib/campaignExport';
import { freshExportPlan } from '@/lib/exportOptOuts';
import { downloadCsv, toCsv } from '@/lib/csv';
import { formatCount } from '@/lib/format';

type Tab = 'import' | 'city' | 'history' | 'export';

export function ImportExport() {
  const [tab, setTab] = useState<Tab>('import');

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Data Import' }]}
        title="Data Import"
        description="Bring purchased files in, and prepare SmarterContact files to send out."
      />

      <div role="tablist" aria-label="Import or export" className="flex gap-1 border-b border-border">
        {(
          [
            ['import', 'Import a file'],
            ['city', 'Search a city (Land Portal)'],
            ['history', 'SmarterContact history'],
            ['export', 'Export for SmarterContact'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${
              tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'import' && (
        <div className="space-y-6">
          <ImportWizard />
          <ImportHistory />
        </div>
      )}
      {tab === 'city' && <CitySearch />}
      {tab === 'history' && <SmarterContactHistory />}
      {tab === 'export' && <ExportBuilder />}
    </div>
  );
}

function ExportBuilder() {
  const { data, isPending, isError, refetch } = useRecordsQuery();
  const [county, setCounty] = useState('');

  const records = useMemo(() => data?.data ?? [], [data]);
  const counties = useMemo(() => [...new Set(records.map((r) => `${r.county}|${r.state}`))].sort(), [records]);
  const scoped = useMemo(
    () => (county ? records.filter((r) => `${r.county}|${r.state}` === county) : records),
    [records, county],
  );
  const suppressed = useSuppressedPhonesQuery();
  const plan = useMemo(() => planCampaignExport(scoped, suppressed.data), [scoped, suppressed.data]);
  const preview = plan.included.slice(0, 8);

  if (isPending) return <CardSkeleton rows={6} />;

  if (isError) {
    return <ErrorState message="Records could not be loaded for export." onRetry={() => refetch()} />;
  }

  if (records.length === 0) {
    return (
      <div className="card">
        <EmptyState title="Nothing to export yet" description="Import a dataset first, then prepare a SmarterContact file here." />
      </div>
    );
  }

  const scopeName = county ? county.split('|')[0] : 'All';
  const [checkingOptOuts, setCheckingOptOuts] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const exportFile = async () => {
    setCheckingOptOuts(true);
    setExportNote(null);
    const fresh = await freshExportPlan(scoped);
    setCheckingOptOuts(false);
    if (!fresh.ok) {
      setExportNote(fresh.message);
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`SmarterContact_${scopeName}_${stamp}.csv`, toCsv(SMARTERCONTACT_HEADERS, fresh.plan.included.map(toSmarterContactRow)));
    setExportNote(`Opt-out list checked at ${new Date(fresh.checkedAt).toLocaleTimeString()}. ${fresh.plan.included.length.toLocaleString('en-US')} records exported.`);
  };

  return (
    <div className="space-y-6">
      <div className="card grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-end">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          Scope
          <SearchableSelect
            ariaLabel="Scope"
            placeholder="All counties"
            value={county}
            onChange={setCounty}
            options={counties.map((c) => {
              const [name, state] = c.split('|');
              return { value: c, label: `${name}, ${state}` };
            })}
          />
        </label>
        {exportNote && (
          <p role="status" className="text-xs text-muted-foreground">
            {exportNote}
          </p>
        )}
        <button type="button" className="btn-primary" onClick={exportFile} disabled={checkingOptOuts || suppressed.isPending || suppressed.isError || plan.included.length === 0}>
          <Download size={16} aria-hidden="true" /> Download {formatCount(plan.included.length)} records
        </button>
      </div>

      <section className="card space-y-4 p-5" aria-labelledby="export-summary">
        <h2 id="export-summary" className="text-base font-semibold">
          Export summary
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total selected" value={formatCount(plan.total)} />
          <Stat label="Eligible" value={formatCount(plan.included.length)} tone="good" />
          {EXCLUSION_REASONS.map((reason) => (
            <Stat key={reason} label={reason} value={formatCount(plan.excluded[reason])} />
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          Excluded records are never removed silently. Each one is counted here under the reason it was left out.
        </p>
      </section>

      <section className="card overflow-hidden" aria-labelledby="export-preview">
        <div className="border-b border-border p-4">
          <h2 id="export-preview" className="text-base font-semibold">
            Preview
          </h2>
          <p className="text-xs text-muted-foreground">Exact columns in the file. First {preview.length} of {formatCount(plan.included.length)} rows.</p>
        </div>
        {preview.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No eligible records" description="Everything in this scope is excluded. See the reasons above." />
          </div>
        ) : (
          <div className="overflow-x-auto p-4">
            <table className="w-full min-w-[640px] text-left text-xs">
              <caption className="sr-only">SmarterContact export preview</caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  {SMARTERCONTACT_HEADERS.map((h) => (
                    <th key={h} scope="col" className="px-2 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((record) => (
                  <tr key={record.id} className="border-b border-border last:border-0">
                    {toSmarterContactRow(record).map((value, i) => (
                      <td key={i} className="px-2 py-2">
                        {value === '' ? <span className="text-muted-foreground">—</span> : value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.some((r) => r.ownerType !== 'Individual') && (
              <p className="mt-3 text-xs text-muted-foreground">
                Organization owners keep their full company name in First Name, as SmarterContact requires.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${tone === 'good' ? 'text-green-700 dark:text-green-300' : ''}`}>{value}</dd>
    </div>
  );
}
