import { Download, Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusChip } from '@/components/ui/StatusChip';
import { useInboxCountsQuery, useInboxQuery, usePropertySummariesQuery, useRecordsQuery } from '@/hooks/useNextCrestData';
import { EMPTY_INBOX_FILTERS } from '@/lib/inboxFilters';
import { exportInbox, type InboxFolderKey, type InboxRecord } from '@/services/nextcrestData';
import type { LandRecord } from '@/data/types';
import { daysSince, formatAcres, formatDate } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/csv';
import { planCampaignExport, SMARTERCONTACT_HEADERS, toSmarterContactRow } from '@/lib/campaignExport';

// Follow-up labels in SmarterContact. Each one gets its own tab, showing the Inbox conversations with that label.
const FOLLOW_UP_LABELS = ['FU', 'FU-LT', 'FU-Offer', 'Lead-FU'] as const;

type TabKey = 'today' | 'rehit' | 'never' | 'responders' | 'awaiting';

const TABS: { key: TabKey; label: string; empty: string; matches: (r: LandRecord) => boolean }[] = [
  {
    key: 'today',
    label: 'Follow up today',
    empty: 'Nothing is due for a follow-up. The queue refills as the waiting period ends.',
    matches: (r) => r.status === 'followup_due',
  },
  {
    key: 'rehit',
    label: 'Re-hit due (90d)',
    empty: 'No properties have reached the 90-day re-hit point.',
    matches: (r) => r.status === 'rehit_due',
  },
  {
    key: 'never',
    label: 'Never marketed',
    empty: 'Every property has been texted at least once.',
    matches: (r) => r.status === 'never_marketed',
  },
  {
    key: 'responders',
    label: 'Responders',
    empty: 'No owners have replied yet.',
    matches: (r) => r.responded && r.status !== 'opted_out' && r.status !== 'wrong_number',
  },
  {
    // SmarterContact conversations waiting for a reply. Shown by AwaitingReplyTable, not from the property records.
    key: 'awaiting',
    label: 'Awaiting reply',
    empty: 'No conversations are waiting for a reply.',
    matches: () => false,
  },
];

function isTab(value: string | null): value is TabKey {
  return TABS.some((t) => t.key === value);
}

// Follow-up conversations with the chosen label(s), checked against the property records. A row is matched when the
// conversation's phone number is on a property; otherwise it shows as not matched.
function LabelFollowUpTable({ labels, title, emptyDescription }: { labels: string[]; title: string; emptyDescription: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { data, isPending, isError, refetch } = useInboxQuery({
    folder: 'all',
    search: '',
    filters: { ...EMPTY_INBOX_FILTERS, includeLabels: labels, includeMode: 'any' },
    sortKey: 'last_message_at',
    sortDir: 'desc',
    page,
    pageSize,
  });
  const rows = data?.rows ?? [];
  const propertyIds = rows.map((r) => r.propertyId).filter((id): id is string => !!id);
  const properties = usePropertySummariesQuery(propertyIds);
  const byId = properties.data ?? {};
  const matched = rows.filter((r) => r.propertyId && byId[r.propertyId]).length;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          {title}. Checked against property records by phone number. {matched} of {rows.length} on this page matched. Replies are sent in SmarterContact.
        </span>
        <Link to="/inbox" className="btn-secondary h-9 px-3">
          Open Inbox
        </Link>
      </div>
      {isError ? (
        <ErrorState message="The follow-up list could not be loaded." onRetry={() => refetch()} />
      ) : (
        <DataTable<InboxRecord>
          caption={title}
          isLoading={isPending}
          rows={rows}
          rowKey={(r) => r.contactId}
          empty={
            rows.length === 0 && !isPending ? <EmptyState tone="success" title="All caught up" description={emptyDescription} /> : null
          }
          server={{
            total: data?.total ?? 0,
            page,
            pageSize,
            sort: null,
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPageSize(size);
              setPage(1);
            },
            onSortChange: () => undefined,
          }}
          columns={[
            {
              key: 'contact',
              header: 'Contact',
              cell: (r) => (
                <div className="min-w-0">
                  <div className="font-medium">{r.name || 'No name'}</div>
                  <div className="font-mono text-xs text-muted-foreground">{r.phone || '—'}</div>
                </div>
              ),
            },
            {
              key: 'labels',
              header: 'Labels',
              cell: (r) => (
                <div className="flex flex-wrap gap-1">
                  {r.labels
                    .filter((l) => labels.includes(l))
                    .map((l) => (
                      <span key={l} className="rounded-full bg-accent px-2 py-0.5 text-xs">
                        {l}
                      </span>
                    ))}
                </div>
              ),
            },
            {
              key: 'property',
              header: 'Property record',
              cell: (r) => {
                const p = r.propertyId ? byId[r.propertyId] : undefined;
                if (!p) return <span className="text-muted-foreground">Not matched</span>;
                return (
                  <div className="min-w-0">
                    <div className="font-mono text-xs">{p.apn}</div>
                    <div className="break-words text-xs text-muted-foreground">
                      {p.owner || '—'} · {p.county}, {p.state}
                    </div>
                  </div>
                );
              },
            },
            {
              key: 'acres',
              header: 'Acres',
              hideBelow: 'lg',
              cell: (r) => {
                const p = r.propertyId ? byId[r.propertyId] : undefined;
                return p?.acres == null ? '—' : formatAcres(p.acres);
              },
            },
            {
              key: 'contacts',
              header: 'Times contacted',
              hideBelow: 'md',
              cell: (r) => {
                const p = r.propertyId ? byId[r.propertyId] : undefined;
                return p ? <span className="tabular-nums">{p.totalContacts}</span> : '—';
              },
            },
            {
              key: 'last',
              header: 'Last message',
              hideBelow: 'md',
              cell: (r) => (
                <span className="text-xs text-muted-foreground">
                  {r.lastMessageAt ? formatDate(r.lastMessageAt) : '—'}
                </span>
              ),
            },
            {
              key: 'open',
              header: '',
              cell: (r) =>
                r.propertyId ? (
                  <Link to={`/properties/${r.propertyId}`} className="text-primary hover:underline">
                    Open property
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                ),
            },
          ]}
        />
      )}
    </div>
  );
}

// A follow-up list from the Inbox data: one SmarterContact folder, optionally narrowed to some labels.
function InboxListTable({
  folder,
  labels,
  title,
  emptyDescription,
  openHref,
}: {
  folder: InboxFolderKey;
  labels?: string[];
  title: string;
  emptyDescription: string;
  openHref: string;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const listFilters = labels ? { ...EMPTY_INBOX_FILTERS, includeLabels: labels, includeMode: 'any' as const } : EMPTY_INBOX_FILTERS;
  const { data, isPending, isError, refetch } = useInboxQuery({
    folder,
    search: '',
    filters: listFilters,
    sortKey: 'last_message_at',
    sortDir: 'desc',
    page,
    pageSize,
  });
  const rows = data?.rows ?? [];

  const exportAwaiting = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const all = await exportInbox({ folder, search: '', filters: listFilters, sortKey: 'last_message_at', sortDir: 'desc' });
      const body = all.map((r) => [r.name, r.phone, r.email, r.lastMessage ?? '', r.lastMessageAt ?? '', r.propertyId ? 'Yes' : 'No']);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${stamp}.csv`, toCsv(['Name', 'Phone', 'Email', 'Last message', 'Last message date', 'Property matched'], body));
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm">
        <span className="text-muted-foreground">{title}. Replies are sent in SmarterContact.</span>
        <div className="flex items-center gap-2">
          <Link to={openHref} className="btn-secondary h-9 px-3">
            Open in Inbox
          </Link>
          <button type="button" className="btn-secondary h-9 px-3" disabled={exporting || (data?.total ?? 0) === 0} onClick={exportAwaiting}>
            {exporting ? 'Exporting…' : `Export ${(data?.total ?? 0).toLocaleString('en-US')}`}
          </button>
        </div>
      </div>
      {exportError && (
        <p role="alert" className="px-4 pt-3 text-xs text-red-600 dark:text-red-400">
          {exportError}
        </p>
      )}
      {isError ? (
        <ErrorState message="The awaiting-reply list could not be loaded." onRetry={() => refetch()} />
      ) : (
        <DataTable<InboxRecord>
          caption="Awaiting reply"
          isLoading={isPending}
          rows={rows}
          rowKey={(r) => r.contactId}
          empty={
            rows.length === 0 && !isPending ? (
              <EmptyState tone="success" title="All caught up" description={emptyDescription} />
            ) : null
          }
          server={{
            total: data?.total ?? 0,
            page,
            pageSize,
            sort: null,
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPageSize(size);
              setPage(1);
            },
            onSortChange: () => undefined,
          }}
          columns={[
            {
              key: 'name',
              header: 'Name',
              cell: (r) => (
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.name || 'No name'}</div>
                  <div className="font-mono text-xs text-muted-foreground">{r.phone || '—'}</div>
                </div>
              ),
            },
            {
              key: 'last',
              header: 'Last message',
              cell: (r) => <span className="line-clamp-2">{r.lastMessage ?? <span className="text-muted-foreground">Not synced yet</span>}</span>,
            },
            {
              key: 'date',
              header: 'Date',
              cell: (r) => <span className="whitespace-nowrap text-xs text-muted-foreground">{r.lastMessageAt ? formatDate(r.lastMessageAt) : '—'}</span>,
              hideBelow: 'md',
            },
            {
              key: 'property',
              header: 'Property',
              cell: (r) =>
                r.propertyId ? (
                  <Link to={`/properties/${r.propertyId}`} className="text-primary hover:underline">
                    Open property
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Not matched</span>
                ),
              hideBelow: 'lg',
            },
          ]}
        />
      )}
    </div>
  );
}

export function FollowUpQueue() {
  const { data, isPending, isError, refetch } = useRecordsQuery();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: TabKey = isTab(requested) ? requested : 'today';
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const counts = useInboxCountsQuery();
  // The label filter on Follow up today: "all" or one follow-up label.
  const [followLabel, setFollowLabel] = useState<'all' | (typeof FOLLOW_UP_LABELS)[number]>('all');
  // Count of conversations carrying any follow-up label (for the Follow up today tab).
  const followUpLabels = useInboxQuery({
    folder: 'all',
    search: '',
    filters: { ...EMPTY_INBOX_FILTERS, includeLabels: [...FOLLOW_UP_LABELS], includeMode: 'any' },
    sortKey: 'last_message_at',
    sortDir: 'desc',
    page: 1,
    pageSize: 1,
  });
  const awaiting = tab === 'awaiting';

  const activeTab = TABS.find((t) => t.key === tab)!;
  const queue = useMemo(
    () => (data?.data ?? []).filter(activeTab.matches),
    [data, activeTab],
  );
  const doneInQueue = queue.filter((r) => done.has(r.id)).length;
  const progress = queue.length ? Math.round((doneInQueue / queue.length) * 100) : 0;

  const plan = planCampaignExport(queue);

  const exportQueue = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `smartercontact_${tab}_${stamp}.csv`,
      toCsv(SMARTERCONTACT_HEADERS, plan.included.map(toSmarterContactRow)),
    );
  };

  const toggleDone = (id: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Follow-Up Queue' }]}
        title="Follow-Up Queue"
        description="Your daily work. Pick a tab, work down the list, then export the file for SmarterContact."
        actions={
          <button type="button" className="btn-primary" onClick={exportQueue} disabled={isPending || plan.included.length === 0}>
            <Download size={16} aria-hidden="true" />
            Export {plan.included.length.toLocaleString('en-US')} for SmarterContact
          </button>
        }
      />

      <div role="tablist" aria-label="Queue" className="flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => {
          // Follow up today = the property queue plus the conversations carrying a follow-up label.
          const count: number | null =
            t.key === 'awaiting'
              ? (counts.data?.awaiting_reply ?? 0)
              : t.key === 'today'
                ? (followUpLabels.data?.total ?? 0) + (data?.data ?? []).filter(t.matches).length
                : (data?.data ?? []).filter(t.matches).length;
          const selected = t.key === tab;
          return (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => setParams({ tab: t.key }, { replace: true })}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                selected ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              {count !== null && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{count}</span>}
            </button>
          );
        })}
      </div>

      {!awaiting && (
        <div className="card grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
          <ProgressBar value={progress} label={`${doneInQueue} of ${queue.length} done in this view`} />
          <p className="text-xs text-muted-foreground md:text-right">
            Marking done is kept for this browser session until the database is connected.
          </p>
        </div>
      )}

      {/* One table for all follow-up labels, with a filter to narrow it to one label. */}
      {tab === 'today' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Label</span>
            <div role="group" aria-label="Follow-up label filter" className="flex flex-wrap gap-1">
              {(['all', ...FOLLOW_UP_LABELS] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={followLabel === option}
                  onClick={() => setFollowLabel(option)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    followLabel === option ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent'
                  }`}
                >
                  {option === 'all' ? 'All follow-ups' : option}
                </button>
              ))}
            </div>
          </div>
          <LabelFollowUpTable
            key={followLabel}
            labels={followLabel === 'all' ? [...FOLLOW_UP_LABELS] : [followLabel]}
            title={followLabel === 'all' ? 'Follow-up labels (FU, FU-LT, FU-Offer, Lead-FU)' : `${followLabel} follow-ups`}
            emptyDescription={
              followLabel === 'all' ? 'No conversations carry a follow-up label in the synced data.' : `No conversations have the ${followLabel} label in the synced data.`
            }
          />
        </div>
      )}

      {awaiting ? (
        <InboxListTable
          folder="awaiting_reply"
          title="Awaiting reply"
          emptyDescription="No conversations are waiting for a reply."
          openHref="/inbox?folder=awaiting_reply"
        />
      ) : isError ? (
        <ErrorState message="The queue could not be loaded." onRetry={() => refetch()} />
      ) : (
        <div className="card overflow-hidden">
          <DataTable<LandRecord>
            caption={activeTab.label}
            isLoading={isPending}
            rows={queue}
            rowKey={(r) => r.id}
            empty={
              queue.length === 0 && !isPending ? (
                <EmptyState tone="success" title="All caught up" description={activeTab.empty} />
              ) : null
            }
            columns={[
              {
                key: 'done',
                header: 'Done',
                className: 'w-12',
                cell: (r) => (
                  <button
                    type="button"
                    onClick={() => toggleDone(r.id)}
                    aria-pressed={done.has(r.id)}
                    aria-label={`Mark ${r.ownerName} done`}
                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                      done.has(r.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'
                    }`}
                  >
                    {done.has(r.id) && <Check size={10} aria-hidden="true" />}
                  </button>
                ),
              },
              {
                key: 'owner',
                header: 'Owner',
                cell: (r) => (
                  <div className="min-w-0">
                    <div className="break-words font-medium">{r.ownerName}</div>
                    <div className="font-mono text-xs text-muted-foreground">{r.apn}</div>
                  </div>
                ),
                sortValue: (r) => r.ownerName,
                searchValue: (r) => `${r.ownerName} ${r.apn}`,
              },
              {
                key: 'county',
                header: 'County',
                cell: (r) => `${r.county}, ${r.state}`,
                hideBelow: 'md',
                sortValue: (r) => `${r.state} ${r.county}`,
                searchValue: (r) => `${r.county} ${r.state}`,
              },
              { key: 'acres', header: 'Acres', cell: (r) => formatAcres(r.acres), hideBelow: 'lg', sortValue: (r) => r.acres },
              { key: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} />, sortValue: (r) => r.status },
              {
                key: 'times',
                header: 'Times contacted',
                cell: (r) => <span className="tabular-nums">{r.timesContacted}</span>,
                className: 'text-center',
                sortValue: (r) => r.timesContacted,
              },
              {
                key: 'last',
                header: 'Last contacted',
                cell: (r) => {
                  const days = daysSince(r.lastContactedAt);
                  return (
                    <span className="text-xs text-muted-foreground">
                      {days === null ? 'Never' : `${formatDate(r.lastContactedAt)} (${days}d ago)`}
                    </span>
                  );
                },
                hideBelow: 'md',
                sortValue: (r) => r.lastContactedAt,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
