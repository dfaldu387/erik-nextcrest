import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusChip } from '@/components/ui/StatusChip';
import { useScopedRecords } from '@/hooks/useNextCrestData';
import type { LandRecord } from '@/data/types';
import { daysSince, formatDate } from '@/lib/format';

const NOT_RECORDED = 'Not recorded';

export function Responders() {
  const { data, isPending, isError, refetch } = useScopedRecords();
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.data ?? [])
      .filter((r) => r.responded)
      .filter((r) => !term || [r.ownerName, r.apn, r.county].some((v) => v.toLowerCase().includes(term)));
  }, [data, search]);

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Responders' }]}
      title="Responders"
      description="Owners who replied. They are handled by hand and are never added to automated follow-up texts."
    />
  );

  if (isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState message="Responders could not be loaded." onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="w-full sm:max-w-sm">
          <span className="sr-only">Search responders</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search owner, APN or county"
            className="field w-full"
          />
        </label>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {isPending ? 'Loading…' : `${rows.length.toLocaleString('en-US')} responder${rows.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <div className="card overflow-hidden">
        <DataTable<LandRecord>
          caption="Responders"
          isLoading={isPending}
          rows={rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No replies yet" description="Owners who reply will appear here." />}
          columns={[
            {
              key: 'owner',
              header: 'Owner',
              cell: (r) => (
                <Link to={`/properties/${r.id}`} className="font-medium text-primary hover:underline">
                  {r.ownerName}
                </Link>
              ),
              sortValue: (r) => r.ownerName,
            },
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
            { key: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, sortValue: (r) => r.status },
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
            { key: 'class', header: 'Reply type', cell: () => <span className="text-xs text-muted-foreground">{NOT_RECORDED}</span>, hideBelow: 'lg' },
            {
              key: 'assigned',
              header: 'Assigned to',
              cell: (r) => r.assignedTo ?? 'Unassigned',
              hideBelow: 'lg',
              sortValue: (r) => r.assignedTo,
            },
          ]}
        />
      </div>
    </div>
  );
}
