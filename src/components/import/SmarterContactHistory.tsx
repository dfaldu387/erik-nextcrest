import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Save, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/ui/DataTable';
import { Dropzone } from '@/components/ui/Dropzone';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { formatCount, formatTime } from '@/lib/format';
import { type ParsedHistory, parseSmarterContactHistory } from '@/lib/smartercontactHistory';
import {
  listSmarterContactRuns,
  type SmarterContactHistoryResult,
  type SmarterContactRun,
  runSmarterContactHistory,
} from '@/services/nextcrestData';

const RUN_COLUMNS: Column<SmarterContactRun>[] = [
  {
    key: 'imported',
    header: 'Imported',
    cell: (r) => <span className="whitespace-nowrap text-xs">{formatTime(r.created_at)}</span>,
    sortValue: (r) => r.created_at,
  },
  {
    key: 'file',
    header: 'File',
    cell: (r) => <span className="font-mono text-xs">{r.filename}</span>,
    sortValue: (r) => r.filename,
    searchValue: (r) => r.filename,
  },
  {
    key: 'rows',
    header: 'Contacts',
    cell: (r) => <span className="tabular-nums">{formatCount(r.rows_total)}</span>,
    sortValue: (r) => r.rows_total,
  },
  {
    key: 'linked',
    header: 'Linked',
    cell: (r) => <span className="tabular-nums">{formatCount(r.contacts_linked)}</span>,
    sortValue: (r) => r.contacts_linked,
  },
  {
    key: 'review',
    header: 'Need review',
    cell: (r) => <span className="tabular-nums text-muted-foreground">{formatCount(r.rows_review)}</span>,
    sortValue: (r) => r.rows_review,
    hideBelow: 'md',
  },
  {
    key: 'campaigns',
    header: 'Campaigns',
    cell: (r) => <span className="tabular-nums">{formatCount(r.campaigns_touched)}</span>,
    sortValue: (r) => r.campaigns_touched,
    hideBelow: 'md',
  },
  {
    key: 'phones',
    header: 'New phones',
    cell: (r) => <span className="tabular-nums">{formatCount(r.phones_linked)}</span>,
    sortValue: (r) => r.phones_linked,
    hideBelow: 'lg',
  },
];

const MAX_BYTES = 10 * 1024 * 1024;
const REVIEW_SHOWN = 50;

interface Staged {
  filename: string;
  parsed: ParsedHistory;
}

// Imports a SmarterContact campaign export: previews the matches first, then saves them when you confirm.
export function SmarterContactHistory() {
  const queryClient = useQueryClient();
  const runs = useQuery({ queryKey: ['sc-history-runs'], queryFn: () => listSmarterContactRuns() });
  const [staged, setStaged] = useState<Staged | null>(null);
  const [preview, setPreview] = useState<SmarterContactHistoryResult | null>(null);
  const [saved, setSaved] = useState<SmarterContactHistoryResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const check = useMutation({
    mutationFn: (s: Staged) =>
      runSmarterContactHistory({ filename: s.filename, rows: s.parsed.rows, apply: false }),
    onMutate: () => {
      setMessage(null);
      setSaved(null);
    },
    onSuccess: (result) => setPreview(result),
    onError: (e) => setMessage(e instanceof Error ? e.message : 'The file could not be checked.'),
  });

  const save = useMutation({
    mutationFn: (s: Staged) =>
      runSmarterContactHistory({ filename: s.filename, rows: s.parsed.rows, apply: true }),
    onMutate: () => setMessage(null),
    onSuccess: (result) => {
      setSaved(result);
      setPreview(null);
      setStaged(null);
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'The history could not be saved.'),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['properties'] });
      void queryClient.invalidateQueries({ queryKey: ['records'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['sc-history-runs'] });
    },
  });

  async function onFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    const parsed = parseSmarterContactHistory(await file.text());
    if (parsed.error) {
      setStaged(null);
      setPreview(null);
      setMessage(parsed.error);
      return;
    }
    const next = { filename: file.name, parsed };
    setStaged(next);
    setSaved(null);
    check.mutate(next);
  }

  function clear() {
    setStaged(null);
    setPreview(null);
    setMessage(null);
  }

  function confirmSave() {
    if (!staged || !preview) return;
    const ok = window.confirm(
      `Save the SmarterContact history from "${staged.filename}"?\n\n${formatCount(preview.rows_matched)} contacts will be linked to properties, and ${formatCount(preview.rows_review)} rows will be left for review. Matched properties move out of "Never marketed."`,
    );
    if (ok) save.mutate(staged);
  }

  const canSave = Boolean(staged && preview && preview.rows_matched > 0 && !save.isPending);

  return (
    <section aria-labelledby="sc-history-heading" className="card space-y-5 p-5">
      <div>
        <h2 id="sc-history-heading" className="text-base font-semibold">
          SmarterContact campaign history
        </h2>
        <p className="text-sm text-muted-foreground">
          Upload a SmarterContact campaign export. Each contact is matched to a property by APN and county. Nothing is saved until you confirm.
        </p>
      </div>

      {!staged && (
        <div className="space-y-3">
          <Dropzone accept=".csv,text/csv" maxBytes={MAX_BYTES} onFiles={onFiles} onError={setMessage} />
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            One SmarterContact campaign export (CSV) at a time.
          </p>
        </div>
      )}

      {staged && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
          <span className="truncate font-mono text-xs">{staged.filename}</span>
          <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label="Discard this file" title="Discard this file" onClick={clear}>
            <Trash2 className="mx-auto h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {check.isPending && <p className="text-sm text-muted-foreground">Checking matches…</p>}

      {preview && (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Contacts in file" value={formatCount(preview.rows_total)} />
            <Stat label="Will be linked" value={formatCount(preview.rows_matched)} />
            <Stat label="Need review" value={formatCount(preview.rows_review)} />
            <Stat label="Campaigns" value={formatCount(preview.campaigns)} />
            <Stat label="Phone numbers" value={formatCount(preview.phones_linked)} />
          </dl>

          {preview.review.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Not saved (review first)</h3>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <caption className="sr-only">Rows that were not matched</caption>
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="px-3 py-2 font-medium">Row</th>
                      <th scope="col" className="px-3 py-2 font-medium">APN</th>
                      <th scope="col" className="px-3 py-2 font-medium">Owner</th>
                      <th scope="col" className="px-3 py-2 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.review.slice(0, REVIEW_SHOWN).map((r) => (
                      <tr key={r.row} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 tabular-nums">{r.row}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.apn || '—'}</td>
                        <td className="px-3 py-2">{r.owner || '—'}</td>
                        <td className="px-3 py-2 text-amber-800 dark:text-amber-300">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows_review > REVIEW_SHOWN && (
                <p className="text-xs text-muted-foreground">
                  Showing the first {REVIEW_SHOWN} of {formatCount(preview.rows_review)} rows that need review.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary h-10 gap-2" disabled={!canSave} onClick={confirmSave}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {save.isPending ? 'Saving…' : `Save ${formatCount(preview.rows_matched)} matched contacts`}
            </button>
            {preview.rows_matched === 0 && (
              <p className="text-sm text-muted-foreground">No contacts matched a property in the database, so there is nothing to save.</p>
            )}
          </div>
        </>
      )}

      {saved && (
        <p role="status" className="flex items-center gap-2 text-sm text-green-800 dark:text-green-300">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Saved {formatCount(saved.contacts_linked)} campaign contacts across {formatCount(saved.campaigns)} campaigns, with {formatCount(saved.phones_linked)} new phone numbers. {formatCount(saved.rows_review)} rows still need review.
        </p>
      )}

      {message && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {message}
        </p>
      )}

      <div className="space-y-2 border-t border-border pt-5">
        <div>
          <h3 className="text-sm font-semibold">Campaign history runs</h3>
          <p className="text-xs text-muted-foreground">Every SmarterContact file saved to the database, newest first.</p>
        </div>
        {runs.isError ? (
          <ErrorState message="Campaign history runs could not be loaded." onRetry={() => runs.refetch()} />
        ) : (
          <DataTable<SmarterContactRun>
            caption="SmarterContact campaign history runs"
            isLoading={runs.isPending}
            rows={runs.data ?? []}
            rowKey={(r) => r.id}
            columns={RUN_COLUMNS}
            defaultSort={{ key: 'imported', dir: 'desc' }}
            defaultPageSize={10}
            searchPlaceholder="Search file names"
            empty={<EmptyState title="No campaign history yet" description="Each SmarterContact file you save appears here." />}
          />
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
