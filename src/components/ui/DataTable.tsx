import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Skeleton } from './States';

export type SortDirection = 'asc' | 'desc';
export interface SortState {
  key: string;
  dir: SortDirection;
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  hideBelow?: 'md' | 'lg';
  // Value used for sorting. Leave out to make the column not sortable.
  sortValue?: (row: T) => string | number | null;
  // Text the table search matches against. Leave out to exclude the column from search.
  searchValue?: (row: T) => string;
}

// Used when the rows come from the server one page at a time. The table then shows the
// controls and the parent fetches the next page, sort or size.
export interface ServerControls {
  total: number;
  page: number; // 1-based
  pageSize: number;
  sort: SortState | null;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSortChange: (sort: SortState) => void;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  empty: ReactNode;
  caption: string;
  // Client mode options (ignored in server mode).
  defaultSort?: SortState;
  defaultPageSize?: number;
  searchPlaceholder?: string;
  // Set when the parent handles paging, sorting and search itself.
  server?: ServerControls;
  // Optional row selection. The parent keeps the selected keys (they can span pages).
  selection?: RowSelection<T>;
}

export interface RowSelection<T> {
  selected: Set<string>;
  onToggle: (row: T) => void;
  // Selects every visible row, or clears them when all are already selected.
  onTogglePage: (rows: T[], allSelected: boolean) => void;
  // Name used in the checkbox label, e.g. "Select Dorothy Coen".
  label: (row: T) => string;
  // Clears every selection, including rows on other pages. Shown in the footer while something is selected.
  onClear?: () => void;
}

const PAGE_SIZES = [10, 25, 50, 100];
const hideClass = { md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const;

// Empty values sort last. Numbers sort as numbers, text sorts naturally ("Unit 2" before "Unit 10").
function compareValues(a: string | number | null, b: string | number | null): number {
  if (a === null || a === '') return b === null || b === '' ? 0 : 1;
  if (b === null || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en-US', { numeric: true, sensitivity: 'base' });
}

// Sortable, searchable and paginated table. Below md, each row becomes a stacked card.
// From md up, it is a regular table.
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  isLoading,
  empty,
  caption,
  defaultSort,
  defaultPageSize = 25,
  searchPlaceholder = 'Search this table',
  server,
  selection,
}: DataTableProps<T>) {
  const [localSort, setLocalSort] = useState<SortState | null>(defaultSort ?? null);
  const [localSearch, setLocalSearch] = useState('');
  const [localPage, setLocalPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(defaultPageSize);

  const isServer = server !== undefined;
  const sort = server ? server.sort : localSort;
  const pageSize = server ? server.pageSize : localPageSize;
  const searchable = !isServer && columns.some((column) => column.searchValue);

  // Client mode: filter and sort the full array, then cut out the current page.
  const processed = useMemo(() => {
    if (isServer) return rows;
    let result = rows;
    const term = localSearch.trim().toLowerCase();
    if (term) {
      const searchColumns = columns.filter((column) => column.searchValue);
      result = result.filter((row) => searchColumns.some((column) => column.searchValue!(row).toLowerCase().includes(term)));
    }
    const column = sort ? columns.find((c) => c.key === sort.key) : undefined;
    if (sort && column?.sortValue) {
      const getValue = column.sortValue;
      const direction = sort.dir === 'asc' ? 1 : -1;
      result = [...result].sort((a, b) => compareValues(getValue(a), getValue(b)) * direction);
    }
    return result;
  }, [isServer, rows, columns, localSearch, sort]);

  const total = server ? server.total : processed.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(server ? server.page : localPage, pageCount);
  const visible = server ? rows : processed.slice((page - 1) * pageSize, page * pageSize);
  const isEmpty = !isLoading && visible.length === 0;
  const showFooter = !isLoading && total > 0;
  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, total);

  const sortableColumns = columns.filter((column) => column.sortValue);

  const applySort = (next: SortState) => {
    if (server) {
      server.onSortChange(next);
    } else {
      setLocalSort(next);
      setLocalPage(1);
    }
  };

  const toggleSort = (key: string) => {
    applySort(sort?.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const goToPage = (next: number) => {
    if (server) server.onPageChange(next);
    else setLocalPage(next);
  };

  const changePageSize = (size: number) => {
    if (server) server.onPageSizeChange(size);
    else {
      setLocalPageSize(size);
      setLocalPage(1);
    }
  };

  const activate = (row: T) => {
    if (onRowClick) onRowClick(row);
  };

  const sortIcon = (key: string) => {
    if (sort?.key !== key) return <ArrowUpDown size={12} aria-hidden="true" className="opacity-40" />;
    return sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />;
  };

  const ariaSort = (key: string, sortable: boolean): 'ascending' | 'descending' | 'none' | undefined => {
    if (!sortable) return undefined;
    if (sort?.key !== key) return 'none';
    return sort.dir === 'asc' ? 'ascending' : 'descending';
  };

  const pageSelected = selection ? visible.length > 0 && visible.every((row) => selection.selected.has(rowKey(row))) : false;

  const selectionCheckbox = (row: T) =>
    selection && (
      <input
        type="checkbox"
        aria-label={selection.label(row)}
        checked={selection.selected.has(rowKey(row))}
        onChange={() => selection.onToggle(row)}
        onClick={(event) => event.stopPropagation()}
        className="h-4 w-4 cursor-pointer"
      />
    );

  const pager = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <span aria-live="polite">
        {selection && selection.selected.size > 0 && (
          <span className="mr-3 inline-flex items-center gap-2 font-medium text-foreground">
            {selection.selected.size.toLocaleString('en-US')} selected
            {selection.onClear && (
              <button type="button" onClick={selection.onClear} className="font-medium text-primary hover:underline">
                Clear
              </button>
            )}
          </span>
        )}
        Showing {firstShown.toLocaleString('en-US')}–{lastShown.toLocaleString('en-US')} of {total.toLocaleString('en-US')}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => changePageSize(Number(event.target.value))}
            className="field h-8 w-auto py-0 text-xs"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span className="tabular-nums">
          Page {page.toLocaleString('en-US')} of {pageCount.toLocaleString('en-US')}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-secondary h-8 px-2 text-xs"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-secondary h-8 px-2 text-xs"
            onClick={() => goToPage(page + 1)}
            disabled={page >= pageCount}
            aria-label="Next page"
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {searchable && (
        <div className="border-b border-border p-3 md:px-4">
          <label className="relative block w-full max-w-xs">
            <span className="sr-only">Search {caption}</span>
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={localSearch}
              onChange={(event) => {
                setLocalSearch(event.target.value);
                setLocalPage(1);
              }}
              placeholder={searchPlaceholder}
              className="field h-9 w-full pl-8 text-sm"
            />
          </label>
        </div>
      )}

      {/* Mobile sort control: the card view has no column headers to click. */}
      {sortableColumns.length > 0 && (
        <div className="flex items-center gap-2 px-3 pt-3 md:hidden">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
            Sort by
            <select
              value={sort?.key ?? ''}
              onChange={(event) => applySort({ key: event.target.value, dir: sort?.dir ?? 'asc' })}
              className="field h-9 min-w-0 flex-1 text-sm"
            >
              {!sort && <option value="" disabled>Choose a column</option>}
              {sortableColumns.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.header}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary h-9 px-3 text-xs"
            disabled={!sort}
            onClick={() => sort && applySort({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
          >
            {sort?.dir === 'desc' ? 'Descending' : 'Ascending'}
          </button>
        </div>
      )}

      <div className="space-y-3 p-3 md:hidden">
        {isLoading &&
          Array.from({ length: 4 }, (_, i) => (
            <div key={`card-skeleton-${i}`} className="space-y-2 rounded-md border border-border p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        {!isLoading &&
          visible.map((row) => (
            <div
              key={rowKey(row)}
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => activate(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        activate(row);
                      }
                    }
                  : undefined
              }
              className={`rounded-md border border-border bg-card p-4 ${
                onRowClick ? 'cursor-pointer hover:bg-muted focus-visible:bg-muted' : ''
              }`}
            >
              {selection && <div className="mb-2 flex justify-end">{selectionCheckbox(row)}</div>}
              <dl className="space-y-2">
                {columns.map((column) => (
                  <div key={column.key} className="flex items-start justify-between gap-4 text-sm">
                    <dt className="shrink-0 text-xs text-muted-foreground">{column.header}</dt>
                    <dd className="min-w-0 text-right">{column.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              {selection && (
                <th scope="col" className="sticky top-0 w-10 bg-card px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={pageSelected}
                    onChange={() => selection.onTogglePage(visible, pageSelected)}
                    className="h-4 w-4 cursor-pointer"
                  />
                </th>
              )}
              {columns.map((column) => {
                const sortable = Boolean(column.sortValue);
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={ariaSort(column.key, sortable)}
                    className={`sticky top-0 bg-card px-4 py-3 font-medium ${column.hideBelow ? hideClass[column.hideBelow] : ''} ${column.className ?? ''}`}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="inline-flex items-center gap-1 rounded uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {column.header}
                        {sortIcon(column.key)}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={`skeleton-${i}`} className="border-b border-border">
                  {selection && <td className="px-4 py-3" />}
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))}
            {!isLoading &&
              visible.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => activate(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter') activate(row);
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  className={`border-b border-border last:border-0 ${
                    onRowClick ? 'cursor-pointer hover:bg-muted focus-visible:bg-muted' : ''
                  }`}
                >
                  {selection && <td className="px-4 py-3 align-middle">{selectionCheckbox(row)}</td>}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-3 align-middle ${column.hideBelow ? hideClass[column.hideBelow] : ''} ${column.className ?? ''}`}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showFooter && pager}
      {isEmpty && <div>{empty}</div>}
    </>
  );
}
