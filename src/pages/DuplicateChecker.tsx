import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataTable } from '@/components/ui/DataTable';
import { Dropzone } from '@/components/ui/Dropzone';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/States';
import { MergePanel } from '@/components/duplicates/MergePanel';
import { OwnedChip } from '@/components/ui/StatusChip';
import { useRecordsQuery } from '@/hooks/useNextCrestData';
import { downloadCsv, parseCsv, toCsv } from '@/lib/csv';
import { buildOwnedIndex, classifyCandidate } from '@/lib/duplicates';
import type { DuplicateCheckRow, DuplicateStatus } from '@/lib/duplicates';
import { formatCount, formatDate } from '@/lib/format';

const MAX_BYTES = 10 * 1024 * 1024;

interface Candidate {
  apn: string;
  state: string;
  county: string;
}

interface ResultRow extends DuplicateCheckRow {
  index: number;
}

interface ParsedFile {
  name: string;
  candidates: Candidate[];
  missingStateCounty: boolean;
}

function findColumn(headers: string[], pattern: RegExp): number {
  return headers.findIndex((h) => pattern.test(h.trim().toLowerCase()));
}

function parseUpload(name: string, text: string): ParsedFile | { error: string } {
  const table = parseCsv(text);
  if (table.length < 2) return { error: 'The file needs a header row and at least one property.' };

  const [headers, ...body] = table;
  const apnCol = findColumn(headers, /^(apn|parcel.*|parcel id)$/);
  const stateCol = findColumn(headers, /^state$/);
  const countyCol = findColumn(headers, /^county$/);
  if (apnCol < 0) return { error: 'No APN or Parcel ID column was found in this file.' };

  return {
    name,
    missingStateCounty: stateCol < 0 || countyCol < 0,
    candidates: body.map((cells) => ({
      apn: cells[apnCol] ?? '',
      state: stateCol >= 0 ? (cells[stateCol] ?? '') : '',
      county: countyCol >= 0 ? (cells[countyCol] ?? '') : '',
    })),
  };
}

export function DuplicateChecker() {
  const { data, isPending } = useRecordsQuery();
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [included, setIncluded] = useState<Set<number>>(new Set());

  const owned = useMemo(() => buildOwnedIndex(data?.data ?? []), [data]);

  const results: ResultRow[] = useMemo(
    () =>
      (file?.candidates ?? []).map((candidate, index) => ({
        ...classifyCandidate(candidate, owned),
        index,
      })),
    [file, owned],
  );

  const counts = useMemo(() => {
    const c: Record<DuplicateStatus, number> = { owned: 0, new: 0, invalid: 0, review: 0 };
    for (const r of results) c[r.status] += 1;
    return c;
  }, [results]);

  const acceptFile = (f: File) => {
    setMessage(null);
    f.text().then((text) => {
      const parsed = parseUpload(f.name, text);
      if ('error' in parsed) {
        setFile(null);
        setMessage(parsed.error);
        return;
      }
      setFile(parsed);
      const next = new Set<number>();
      parsed.candidates.forEach((candidate, index) => {
        if (classifyCandidate(candidate, owned).status === 'new') next.add(index);
      });
      setIncluded(next);
    });
  };

  const toggle = (index: number) =>
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const safeToBuy = results.filter((r) => r.status === 'new' && included.has(r.index));
  const stamp = new Date().toISOString().slice(0, 10);
  const percentOwned = results.length ? Math.round((counts.owned / results.length) * 100) : 0;

  const exportSafe = () =>
    downloadCsv(
      `safe_to_buy_${stamp}.csv`,
      toCsv(['APN', 'State', 'County'], safeToBuy.map((r) => [r.apn, r.state, r.county])),
    );

  const exportOwned = () =>
    downloadCsv(
      `already_owned_${stamp}.csv`,
      toCsv(
        ['APN', 'State', 'County', 'Owned Since'],
        results
          .filter((r) => r.status === 'owned')
          .map((r) => [r.apn, r.state, r.county, formatDate(r.ownedSince)]),
      ),
    );

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Duplicate Checker' }]}
        title="Duplicate Checker"
        description="Check a Land Portal list before you buy it. Only the rows in your file are checked."
      />
      <MergePanel />

      {!isPending && (data?.data.length ?? 0) === 0 && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          No properties are in the database yet, so every row will show as new. Do not use these results to decide what to buy until the database is connected.
        </p>
      )}

      {!file ? (
        <div className="card p-5">
          {isPending ? (
            <p className="text-sm text-muted-foreground">Loading your database…</p>
          ) : (
            <Dropzone
              accept=".csv,text/csv"
              maxBytes={MAX_BYTES}
              onFiles={(files) => {
                if (files[0]) acceptFile(files[0]);
              }}
              onError={setMessage}
            />
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Your file needs an APN or Parcel ID column. Add State and County columns too, so each row can be matched
            exactly. Matching uses APN, state and county together.
          </p>
          {message && (
            <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
              {message}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="card flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Checked file</p>
              <p className="font-medium">{file.name}</p>
              <p className="mt-1 text-sm">
                <span className="font-semibold">{formatCount(results.length)} records</span>,{' '}
                {formatCount(counts.owned)} already owned ({percentOwned}%), {formatCount(counts.new)} new
                {counts.invalid > 0 && `, ${counts.invalid} missing an identifier`}
                {counts.review > 0 && `, ${counts.review} need review`}.
              </p>
              {file.missingStateCounty && (
                <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                  State or County columns were not found, so these rows cannot be confirmed and are marked for review.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => setFile(null)}>
                Check another file
              </button>
              <button type="button" className="btn-secondary" onClick={exportOwned} disabled={counts.owned === 0}>
                <Download size={16} aria-hidden="true" /> Duplicates list
              </button>
              <button type="button" className="btn-primary" onClick={exportSafe} disabled={safeToBuy.length === 0}>
                <Download size={16} aria-hidden="true" /> Safe-to-buy list ({safeToBuy.length})
              </button>
            </div>
          </div>

          <div className="card overflow-hidden">
            <DataTable<ResultRow>
              caption="Duplicate check results"
              rows={results}
              rowKey={(row) => String(row.index)}
              empty={<EmptyState title="No rows in this file" description="The file had a header but no property rows." />}
              columns={[
                {
                  key: 'include',
                  header: 'Buy',
                  className: 'w-16',
                  cell: (row) => (
                    <input
                      type="checkbox"
                      checked={included.has(row.index)}
                      disabled={row.status !== 'new'}
                      onChange={() => toggle(row.index)}
                      aria-label={`Include APN ${row.apn}`}
                      className="h-4 w-4 accent-primary"
                    />
                  ),
                },
                {
                  key: 'apn',
                  header: 'APN',
                  cell: (row) => <span className="font-mono text-xs">{row.apn || '—'}</span>,
                  sortValue: (row) => row.apn,
                  searchValue: (row) => row.apn,
                },
                {
                  key: 'location',
                  header: 'County · State',
                  cell: (row) => (row.county ? `${row.county}, ${row.state}` : '—'),
                  hideBelow: 'md',
                  sortValue: (row) => `${row.state} ${row.county}`,
                  searchValue: (row) => `${row.county} ${row.state}`,
                },
                {
                  key: 'result',
                  header: 'Result',
                  cell: (row) => {
                    if (row.status === 'owned') {
                      return (
                        <div className="space-y-1">
                          <OwnedChip />
                          <div className="text-xs text-muted-foreground">Owned since {formatDate(row.ownedSince)}</div>
                        </div>
                      );
                    }
                    if (row.status === 'new') {
                      return (
                        <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800 ring-1 ring-inset ring-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800">
                          New property
                        </span>
                      );
                    }
                    return <span className="text-xs text-amber-800 dark:text-amber-300">{row.reason}</span>;
                  },
                  sortValue: (row) => row.status,
                },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
