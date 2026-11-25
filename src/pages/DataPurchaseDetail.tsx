import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/States';
import { useMarketsQuery } from '@/hooks/useNextCrestData';
import { formatCount, formatDate } from '@/lib/format';

const NOT_RECORDED = 'Not recorded';

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-border rounded-md border border-border">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataPurchaseDetail() {
  const { id = '' } = useParams();
  const { data, isPending, isError, refetch } = useMarketsQuery();

  if (isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dataset" description="Loading the dataset." />
        <CardSkeleton rows={5} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dataset" description="Could not load this dataset." />
        <ErrorState message="The dataset could not be loaded." onRetry={() => refetch()} />
      </div>
    );
  }

  const dataset = data.data.find((m) => m.id === id);
  if (!dataset) {
    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumbs={[{ label: 'Data Purchases', to: '/purchases' }, { label: 'Not found' }]}
          title="Dataset not found"
          description="No dataset matches this link."
        />
        <div className="card">
          <EmptyState
            title="No dataset with this ID"
            description="Go back to Data Purchases to choose a dataset."
            action={
              <Link to="/purchases" className="btn-primary">
                Back to Data Purchases
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Data Purchases', to: '/purchases' }, { label: dataset.county }]}
        title={`${dataset.county} County, ${dataset.state}`}
        description={dataset.name}
        actions={
          <Link to={`/properties?state=${dataset.state}&county=${dataset.county}`} className="btn-primary">
            View properties in this dataset
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold">Purchase</h2>
          <Facts
            rows={[
              ['Dataset name', <span key="n" className="font-mono text-xs">{dataset.name}</span>],
              ['Source provider', 'Land Portal'],
              ['Purchase date', formatDate(dataset.purchasedAt)],
              ['Cost', NOT_RECORDED],
              ['Purchased by', NOT_RECORDED],
              ['API acquisition ID', NOT_RECORDED],
              ['Source file', 'Not stored yet'],
            ]}
          />
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold">Applied filters</h2>
          <Facts
            rows={[
              ['State', dataset.state],
              ['County', dataset.county],
              ['Acreage range', dataset.acreRange],
              ['Ownership period', dataset.ownership],
              ['ZIP', NOT_RECORDED],
            ]}
          />
        </section>
      </div>

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">Import results</h2>
        <Facts
          rows={[
            ['Records in dataset', formatCount(dataset.recordCount)],
            ['New properties', NOT_RECORDED],
            ['Duplicates found at import', NOT_RECORDED],
            ['Failed records', NOT_RECORDED],
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Import counts are stored when a file is imported to the database. Nothing has been imported yet.
        </p>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">Marketing outcome</h2>
        <Facts
          rows={[
            ['Records contacted', `${dataset.contactedShare}%`],
            ['Average texts per record', dataset.avgContacts.toFixed(1)],
            ['Response rate', `${dataset.responseRate}%`],
          ]}
        />
      </section>

      <section className="card">
        <EmptyState
          title="No processing logs yet"
          description="Import and processing logs for this dataset will appear here once imports write to the database."
        />
      </section>
    </div>
  );
}
