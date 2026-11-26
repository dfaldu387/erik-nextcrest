import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ConversationPanel } from '@/components/inbox/ConversationPanel';
import { InboxFilterDialog } from '@/components/inbox/InboxFilterDialog';
import { type Column, DataTable, type SortState } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { useInboxCountsQuery, useInboxFilterOptionsQuery, useInboxQuery } from '@/hooks/useNextCrestData';
import { downloadCsv, toCsv } from '@/lib/csv';
import { formatCount, formatDate, formatTime } from '@/lib/format';
import { EMPTY_INBOX_FILTERS, countActiveFilters, type InboxFilters } from '@/lib/inboxFilters';
import {
  exportInbox,
  INBOX_FOLDER_OPTIONS,
  type InboxFolderKey,
  type InboxRecord,
  type InboxSortKey,
} from '@/services/nextcrestData';

const EXPORT_HEADERS = ['Name', 'Phone', 'Email', 'Last message', 'Last message date', 'Direction', 'Labels', 'Folders', 'Property matched'];

// Waits for typing to pause so each keystroke does not send a database request.
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// "8434758031" -> "(843) 475-8031"
function formatPhone(digits: string): string {
  if (!/^\d{10}$/.test(digits)) return digits || '—';
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Table column keys mapped to the database sort column. Labels and property cannot be sorted.
const SORT_COLUMN: Record<string, InboxSortKey> = {
  name: 'name',
  conversation: 'last_message',
  date: 'last_message_at',
};
const COLUMN_FOR_SORT: Record<InboxSortKey, string> = {
  name: 'name',
  last_message: 'conversation',
  last_message_at: 'date',
};

// Summaries of the applied filters, one chip per group, each with its own remove action.
function filterChips(filters: InboxFilters): { key: keyof InboxFilters | 'response'; label: string }[] {
  const chips: { key: keyof InboxFilters | 'response'; label: string }[] = [];
  if (filters.includeLabels.length) {
    chips.push({ key: 'includeLabels', label: `Include (${filters.includeMode}): ${filters.includeLabels.join(', ')}` });
  }
  if (filters.excludeLabels.length) {
    chips.push({ key: 'excludeLabels', label: `Exclude (${filters.excludeMode}): ${filters.excludeLabels.join(', ')}` });
  }
  if (filters.responseFrom || filters.responseTo) {
    chips.push({ key: 'response', label: `Response: ${filters.responseFrom || '…'} to ${filters.responseTo || '…'}` });
  }
  if (filters.areaCodes.length) chips.push({ key: 'areaCodes', label: `Area code: ${filters.areaCodes.join(', ')}` });
  return chips;
}

// The SmarterContact Messenger inbox, copied into NextCrest by the sync. Replies are sent in SmarterContact.
export function Inbox() {
  // The folder can be opened from a link, for example /inbox?folder=awaiting_reply (used by the Follow-ups page).
  const [params] = useSearchParams();
  const requestedFolder = params.get('folder');
  const [folder, setFolder] = useState<InboxFolderKey>(
    INBOX_FOLDER_OPTIONS.some((f) => f.key === requestedFolder) ? (requestedFolder as InboxFolderKey) : 'all',
  );
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<InboxFilters>(EMPTY_INBOX_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortKey, setSortKey] = useState<InboxSortKey>('last_message_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Map<string, InboxRecord>>(new Map());
  const [openRow, setOpenRow] = useState<InboxRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  const counts = useInboxCountsQuery();
  const options = useInboxFilterOptionsQuery();
  const query = { folder, search: debouncedSearch, filters, sortKey, sortDir, page, pageSize };
  const { data, isPending, isError, refetch } = useInboxQuery(query);

  const total = data?.total ?? 0;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const activeCount = countActiveFilters(filters);
  const chips = filterChips(filters);

  // Changing what is listed starts again at page 1. Selections only last while the folder is the same.
  const changeFolder = (next: InboxFolderKey) => {
    setFolder(next);
    setPage(1);
    setSelected(new Map());
  };

  const toggleRow = (row: InboxRecord) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.contactId)) next.delete(row.contactId);
      else next.set(row.contactId, row);
      return next;
    });
  };

  // Selects every row on the page, or clears them when they are all selected already.
  const togglePage = (pageRows: InboxRecord[], allSelected: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const row of pageRows) {
        if (allSelected) next.delete(row.contactId);
        else next.set(row.contactId, row);
      }
      return next;
    });
  };

  const removeChip = (key: keyof InboxFilters | 'response') => {
    setFilters((prev) => {
      if (key === 'response') return { ...prev, responseFrom: '', responseTo: '' };
      if (key === 'includeLabels') return { ...prev, includeLabels: [] };
      if (key === 'excludeLabels') return { ...prev, excludeLabels: [] };
      if (key === 'areaCodes') return { ...prev, areaCodes: [] };
      return prev;
    });
    setPage(1);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = INBOX_FOLDER_OPTIONS[(index + step + INBOX_FOLDER_OPTIONS.length) % INBOX_FOLDER_OPTIONS.length];
    changeFolder(next.key);
    document.getElementById(`inbox-tab-${next.key}`)?.focus();
  };

  const runExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const records =
        selected.size > 0
          ? [...selected.values()]
          : await exportInbox({ folder, search: debouncedSearch, filters, sortKey, sortDir });
      const body = records.map((r) => [
        r.name,
        formatPhone(r.phone),
        r.email,
        r.lastMessage ?? '',
        r.lastMessageAt ?? '',
        r.lastDirection ?? '',
        r.labels.join('; '),
        r.folders.join('; '),
        r.propertyId ? 'Yes' : 'No',
      ]);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`Inbox_${folder}_${stamp}.csv`, toCsv(EXPORT_HEADERS, body));
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<InboxRecord>[] = [
    {
      key: 'name',
      header: 'Name',
      sortValue: (r) => r.name,
      cell: (r) => (
        <div>
          <div className="font-medium">{r.name || r.ownerName || 'No name'}</div>
          <div className="text-xs tabular-nums text-muted-foreground">{formatPhone(r.phone)}</div>
        </div>
      ),
    },
    {
      key: 'conversation',
      header: 'Conversation',
      sortValue: (r) => r.lastMessage,
      className: 'max-w-md',
      cell: (r) => (
        <span className="line-clamp-2" title={r.lastMessage ?? undefined}>
          {r.lastMessage ?? <span className="text-muted-foreground">Not synced yet</span>}
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      sortValue: (r) => r.lastMessageAt,
      className: 'whitespace-nowrap text-xs tabular-nums text-muted-foreground',
      cell: (r) =>
        r.lastMessageAt ? (
          <span className="flex flex-col leading-tight">
            <span>{formatDate(r.lastMessageAt)}</span>
            <span className="text-[11px] text-muted-foreground/80">{formatTime(r.lastMessageAt)}</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'labels',
      header: 'Labels',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.labels.map((label) => (
            <span key={label} className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
              {label}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'property',
      header: 'Property',
      cell: (r) =>
        r.propertyId ? (
          <span className="flex flex-col gap-0.5">
            <Link to={`/properties/${r.propertyId}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              Open property
            </Link>
            {r.propertyCount > 1 && (
              <Link
                to={`/properties?q=${encodeURIComponent(r.ownerName || '')}`}
                onClick={(e) => e.stopPropagation()}
                className="w-fit whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium hover:underline"
                title="Show all properties of this owner"
              >
                {r.propertyCount} properties
              </Link>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">Not matched</span>
        ),
    },
  ];

  const tableSort: SortState = { key: COLUMN_FOR_SORT[sortKey], dir: sortDir };

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Inbox' }]}
        title="Inbox"
        description={`SmarterContact conversations. Last synced ${data?.lastSynced ? formatDate(data.lastSynced) : 'never'}. Replies are sent in SmarterContact.`}
      />

      <div role="tablist" aria-label="Inbox folders" className="flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {INBOX_FOLDER_OPTIONS.map((f, index) => {
          const active = f.key === folder;
          return (
            <button
              key={f.key}
              id={`inbox-tab-${f.key}`}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onKeyDown={(e) => onTabKey(e, index)}
              onClick={() => changeFolder(f.key)}
              className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm ${
                active ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs tabular-nums text-accent-foreground">
                {counts.data ? formatCount(counts.data[f.key]) : '…'}
              </span>
            </button>
          );
        })}
      </div>

      <div className={openRow ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]' : ''}>
      <section role="tabpanel" aria-labelledby={`inbox-tab-${folder}`} className="card min-w-0 space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            Search name or phone
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Name or phone number"
              className="field"
            />
          </label>
          <button type="button" className="btn-secondary h-9 px-3" onClick={() => setFilterOpen(true)}>
            Filters{activeCount > 0 ? ` (${activeCount})` : ''}
          </button>
          <button type="button" className="btn-secondary h-9 px-3" disabled={exporting || (total === 0 && selected.size === 0)} onClick={runExport}>
            {exporting ? 'Exporting…' : selected.size > 0 ? `Export ${formatCount(selected.size)} selected` : `Export ${formatCount(total)} matching`}
          </button>
        </div>

        {(chips.length > 0 || search) && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => removeChip(chip.key)}
                className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 font-medium text-accent-foreground hover:opacity-80"
              >
                {chip.label} <span aria-label={`Remove ${chip.label}`}>✕</span>
              </button>
            ))}
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => {
                setFilters(EMPTY_INBOX_FILTERS);
                setSearch('');
                setPage(1);
              }}
            >
              Clear all
            </button>
          </div>
        )}

        {exportError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {exportError}
          </p>
        )}

        {isError ? (
          <ErrorState message="The inbox could not be loaded." onRetry={() => refetch()} />
        ) : !isPending && total === 0 ? (
          <EmptyState
            title={debouncedSearch || activeCount > 0 ? 'No conversations match' : 'No conversations in this folder'}
            description={
              debouncedSearch || activeCount > 0
                ? 'Try a different search, or clear a filter.'
                : 'Conversations appear here after the SmarterContact sync runs, which happens every minute.'
            }
          />
        ) : (
          <DataTable<InboxRecord>
            caption="Inbox conversations"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.contactId}
            onRowClick={(r) => setOpenRow(r)}
            isLoading={isPending}
            empty={null}
            server={{
              total,
              page,
              pageSize,
              sort: tableSort,
              onPageChange: setPage,
              onPageSizeChange: (size) => {
                setPageSize(size);
                setPage(1);
              },
              onSortChange: (next) => {
                const key = SORT_COLUMN[next.key];
                if (!key) return;
                setSortKey(key);
                setSortDir(next.dir);
                setPage(1);
              },
            }}
            selection={{
              selected: new Set(selected.keys()),
              onToggle: toggleRow,
              onTogglePage: togglePage,
              label: (r) => `Select ${r.name || formatPhone(r.phone)}`,
              onClear: () => setSelected(new Map()),
            }}
          />
        )}
      </section>
      {openRow && <ConversationPanel key={openRow.contactId} row={openRow} onClose={() => setOpenRow(null)} />}
      </div>

      {filterOpen && (
        <InboxFilterDialog
          value={filters}
          labelOptions={options.data?.labels ?? []}
          areaCodeOptions={options.data?.areaCodes ?? []}
          onClose={() => setFilterOpen(false)}
          onApply={(next) => {
            setFilters(next);
            setPage(1);
            setFilterOpen(false);
          }}
        />
      )}
    </div>
  );
}
