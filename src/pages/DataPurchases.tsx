import { LayoutGrid, Rows3 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/States';
import { useMarketsQuery } from '@/hooks/useNextCrestData';
import type { Market } from '@/data/types';
import { daysUntil, formatCount, formatDate } from '@/lib/format';

function RehitBadge({ iso }: { iso: string }) {
  const days = daysUntil(iso);
  const label = days <= 0 ? 'Due now' : `in ${days} day${days === 1 ? '' : 's'}`;
  const tone =
    days <= 7
      ? 'bg-purple-100 text-purple-800 ring-purple-400 dark:bg-purple-950 dark:text-purple-200 dark:ring-purple-700'
      : 'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      Re-hit {label}
    </span>
  );
}

export function DataPurchases() {
  const { data, isPending, isError, refetch } = useMarketsQuery();
  const [view, setView] = useState<'cards' | 'table'>('cards');

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Data Purchases' }]}
      title="Data Purchases"
      description="Each county dataset you bought and imported, with how it has been worked since."
      actions={
        <div role="group" aria-label="View" className="inline-flex rounded-md border border-border bg-card p-0.5">
          <button
            type="button"
            onClick={() => setView('cards')}
            aria-pressed={view === 'cards'}
            className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-sm ${view === 'cards' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}
          >
            <LayoutGrid size={14} aria-hidden="true" /> Cards
          </button>
          <button
            type="button"
            onClick={() => setView('table')}
            aria-pressed={view === 'table'}
            className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-sm ${view === 'table' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}
          >
            <Rows3 size={14} aria-hidden="true" /> Table
          </button>
        </div>
      }
    />
  );

  if (isPending) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <CardSkeleton rows={4} />
          <CardSkeleton rows={4} />
          <CardSkeleton rows={4} />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState message="Data purchases could not be loaded." onRetry={() => refetch()} />
      </div>
    );
  }

  const datasets = data.data;

  return (
    <div className="space-y-6">
      {header}
      {datasets.length === 0 ? (
        <div className="card">
          <EmptyState title="No datasets yet" description="A dataset appears here once you import a purchased file." />
        </div>
      ) : view === 'cards' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {datasets.map((dataset) => (
            <DatasetCard key={dataset.id} dataset={dataset} />
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <DataTable<Market>
            caption="Data purchases"
            rows={datasets}
            rowKey={(m) => m.id}
            empty={<EmptyState title="No datasets yet" description="Import a dataset to see it here." />}
            columns={[
              {
                key: 'dataset',
                header: 'Dataset',
                cell: (m) => (
                  <Link to={`/purchases/${m.id}`} className="font-mono text-xs text-primary hover:underline">
                    {m.name}
                  </Link>
                ),
                sortValue: (m) => m.name,
                searchValue: (m) => m.name,
              },
              { key: 'records', header: 'Records', cell: (m) => formatCount(m.recordCount), sortValue: (m) => m.recordCount },
              { key: 'acres', header: 'Acres', cell: (m) => m.acreRange, hideBelow: 'md', sortValue: (m) => m.acreRange },
              {
                key: 'avg',
                header: 'Avg contacts',
                cell: (m) => m.avgContacts.toFixed(1),
                hideBelow: 'lg',
                sortValue: (m) => m.avgContacts,
              },
              {
                key: 'response',
                header: 'Response rate',
                cell: (m) => `${m.responseRate}%`,
                hideBelow: 'lg',
                sortValue: (m) => m.responseRate,
              },
              {
                key: 'rehit',
                header: 'Next re-hit',
                cell: (m) => <RehitBadge iso={m.nextRehitAt} />,
                sortValue: (m) => m.nextRehitAt,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}

function DatasetCard({ dataset }: { dataset: Market }) {
  return (
    <article className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">
            {dataset.county} County, {dataset.state}
          </h2>
          <Link
            to={`/purchases/${dataset.id}`}
            className="mt-0.5 block truncate font-mono text-xs text-primary hover:underline"
            title={dataset.name}
          >
            {dataset.name}
          </Link>
        </div>
        <RehitBadge iso={dataset.nextRehitAt} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Records</dt>
          <dd className="font-semibold tabular-nums">{formatCount(dataset.recordCount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Acre range</dt>
          <dd className="font-semibold">{dataset.acreRange}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Avg contacts</dt>
          <dd className="font-semibold tabular-nums">{dataset.avgContacts.toFixed(1)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Response rate</dt>
          <dd className="font-semibold tabular-nums">{dataset.responseRate}%</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">Purchased</dt>
          <dd>
            {formatDate(dataset.purchasedAt)} · {dataset.ownership} ownership
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <ProgressBar value={dataset.contactedShare} label="Records contacted" />
      </div>

      <Link to={`/purchases/${dataset.id}`} className="btn-secondary mt-5 w-full">
        Open dataset
      </Link>
    </article>
  );
}
