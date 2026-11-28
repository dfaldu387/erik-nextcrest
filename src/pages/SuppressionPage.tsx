import { Download, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { useScopedRecords } from '@/hooks/useNextCrestData';
import type { LandRecord, MarketingStatus } from '@/data/types';
import { downloadCsv, toCsv } from '@/lib/csv';
import { daysSince, formatDate } from '@/lib/format';

interface SuppressionPageProps {
  status: Extract<MarketingStatus, 'opted_out' | 'wrong_number'>;
  title: string;
  description: string;
  note: string;
}

const NOT_RECORDED = 'Not recorded';

export function SuppressionPage({ status, title, description, note }: SuppressionPageProps) {
  const { data, isPending, isError, refetch } = useScopedRecords();
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.data ?? [])
      .filter((r) => r.status === status)
      .filter((r) => !term || [r.ownerName, r.apn, r.county, r.phone].some((v) => v.toLowerCase().includes(term)));
  }, [data, status, search]);

  const exportRows = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const prefix = status === 'opted_out' ? 'opt_outs' : 'wrong_numbers';
    downloadCsv(
      `${prefix}_${stamp}.csv`,
      toCsv(
        ['Owner', 'Phone', 'APN', 'State', 'County', 'Times texted', 'Last texted'],
        rows.map((r: LandRecord) => [r.ownerName, r.phone, r.apn, r.state, r.county, r.timesContacted, formatDate(r.lastContactedAt)]),
      ),
    );
  };

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: title }]}
      title={title}
      description={description}
      actions={
        <button type="button" className="btn-secondary" onClick={exportRows} disabled={isPending || rows.length === 0}>
          <Download size={16} aria-hidden="true" /> Export shown rows
        </button>
      }
    />
  );

  if (isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState message={`${title} could not be loaded.`} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative w-full sm:max-w-sm">
          <span className="sr-only">Search</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search owner, phone, APN or county"
            className="field w-full pl-9"
          />
        </label>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {isPending ? 'Loading…' : `${rows.length.toLocaleString('en-US')} record${rows.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{note}</p>

      <div className="card overflow-hidden">
        <DataTable<LandRecord>
          caption={title}
          isLoading={isPending}
          rows={rows}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              title={search ? 'No matches' : `No ${title.toLowerCase()} yet`}
              description={search ? 'Try a different search.' : 'Records appear here when they are marked in a campaign.'}
            />
          }
          columns={[
            { key: 'owner', header: 'Owner', cell: (r) => <span className="font-medium">{r.ownerName}</span>, sortValue: (r) => r.ownerName },
            { key: 'phone', header: 'Phone', cell: (r) => <span className="tabular-nums">{r.phone}</span>, sortValue: (r) => r.phone },
            {
              key: 'apn',
              header: 'APN',
              cell: (r) => <span className="font-mono text-xs">{r.apn}</span>,
              hideBelow: 'md',
              sortValue: (r) => r.apn,
            },
            {
              key: 'county',
              header: 'County · State',
              cell: (r) => `${r.county}, ${r.state}`,
              hideBelow: 'md',
              sortValue: (r) => `${r.state} ${r.county}`,
            },
            {
              key: 'texted',
              header: 'Times texted',
              cell: (r) => <span className="tabular-nums">{r.timesContacted}</span>,
              className: 'text-center',
              sortValue: (r) => r.timesContacted,
            },
            {
              key: 'last',
              header: 'Last texted',
              cell: (r) => {
                const days = daysSince(r.lastContactedAt);
                return <span className="text-xs text-muted-foreground">{days === null ? 'Never' : `${formatDate(r.lastContactedAt)} (${days}d ago)`}</span>;
              },
              hideBelow: 'lg',
              sortValue: (r) => r.lastContactedAt,
            },
            { key: 'reason', header: status === 'opted_out' ? 'Reason' : 'Corrected number', cell: () => <span className="text-xs text-muted-foreground">{NOT_RECORDED}</span>, hideBelow: 'lg' },
          ]}
        />
      </div>
    </div>
  );
}
