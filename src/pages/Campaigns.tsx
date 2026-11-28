import { useMemo } from 'react';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/States';
import { useScopedRecords } from '@/hooks/useNextCrestData';
import type { Campaign } from '@/data/types';
import { formatCount, formatDate } from '@/lib/format';
import { buildCampaigns } from '@/lib/metrics';

export function Campaigns() {
  const { data, isPending, isError, refetch } = useScopedRecords();
  const campaigns = useMemo(() => buildCampaigns(data?.data ?? []), [data]);

  const totals = campaigns.reduce(
    (acc, c) => ({
      sent: acc.sent + c.sent,
      responses: acc.responses + c.responses,
      wrongNumbers: acc.wrongNumbers + c.wrongNumbers,
      optOuts: acc.optOuts + c.optOuts,
    }),
    { sent: 0, responses: 0, wrongNumbers: 0, optOuts: 0 },
  );

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Campaigns' }]}
      title="Campaigns"
      description="Texting history by county. Totals come from each property's contact history."
    />
  );

  if (isPending) {
    return (
      <div className="space-y-6">
        {header}
        <CardSkeleton rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState message="Campaigns could not be loaded." onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <section aria-label="Campaign totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Texts sent" value={formatCount(totals.sent)} />
        <Tile label="Replies" value={formatCount(totals.responses)} />
        <Tile label="Wrong numbers" value={formatCount(totals.wrongNumbers)} />
        <Tile label="Opt-outs" value={formatCount(totals.optOuts)} />
      </section>

      <p className="text-xs text-muted-foreground">
        Totals are calculated from each property's contact history. Per-campaign details from SmarterContact (campaign names, send dates, delivery status) appear once that integration is connected.
      </p>

      <div className="card overflow-hidden">
        <DataTable<Campaign>
          caption="Campaigns by county"
          rows={campaigns}
          rowKey={(c) => c.id}
          empty={<EmptyState title="No campaigns yet" description="Campaigns appear once properties have been texted." />}
          columns={[
            {
              key: 'name',
              header: 'Campaign',
              cell: (c) => <span className="font-medium">{c.name}</span>,
              sortValue: (c) => c.name,
              searchValue: (c) => c.name,
            },
            { key: 'contacted', header: 'Properties contacted', cell: (c) => formatCount(c.contacted), sortValue: (c) => c.contacted },
            { key: 'sent', header: 'Texts sent', cell: (c) => formatCount(c.sent), hideBelow: 'md', sortValue: (c) => c.sent },
            { key: 'responses', header: 'Replies', cell: (c) => formatCount(c.responses), sortValue: (c) => c.responses },
            { key: 'rate', header: 'Reply rate', cell: (c) => `${c.responseRate}%`, hideBelow: 'md', sortValue: (c) => c.responseRate },
            { key: 'wrong', header: 'Wrong numbers', cell: (c) => c.wrongNumbers, hideBelow: 'lg', sortValue: (c) => c.wrongNumbers },
            { key: 'optouts', header: 'Opt-outs', cell: (c) => c.optOuts, hideBelow: 'lg', sortValue: (c) => c.optOuts },
            {
              key: 'last',
              header: 'Last activity',
              cell: (c) => formatDate(c.lastActivityAt),
              hideBelow: 'lg',
              sortValue: (c) => c.lastActivityAt,
            },
          ]}
        />
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
