import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { toRawCsv } from '@/lib/csv';
import { buildCommitPhones, buildCommitRows, countsFrom } from '@/lib/importCommit';
import { commitImport } from '@/services/nextcrestData';
import { formatCount } from '@/lib/format';
import type { BatchFile, BatchSummary, ReviewRow } from '@/lib/importReview';

function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}


interface CommitPanelProps {
  files: BatchFile[];
  reviewed: ReviewRow[];
  summary: BatchSummary;
  filename: string;
}

// Saves the new properties from the review to the database, and records the batch.
export function CommitPanel({ files, reviewed, summary, filename }: CommitPanelProps) {
  const queryClient = useQueryClient();
  const [purchaseDate, setPurchaseDate] = useState(todayIso);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const counts = countsFrom(summary, reviewed);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(purchaseDate);

  const save = useMutation({
    mutationFn: () =>
      commitImport({
        filename,
        purchaseDate,
        counts,
        buildRows: (batchId) => buildCommitRows(files, reviewed, purchaseDate, batchId),
        phones: buildCommitPhones(files, reviewed),
        sourceFiles: files.map((f) => ({ name: f.name, csv: toRawCsv(f.table) })),
        onProgress: (done, total) => setProgress({ done, total }),
      }),
    onSettled: () => {
      setProgress(null);
      void queryClient.invalidateQueries({ queryKey: ['import-batches'] });
      void queryClient.invalidateQueries({ queryKey: ['records'] });
      void queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
  });

  return (
    <section aria-labelledby="save-heading" className="card space-y-4 p-5">
      <div>
        <h2 id="save-heading" className="text-base font-semibold">
          Save to the database
        </h2>
        <p className="text-sm text-muted-foreground">
          Adds {formatCount(counts.newRows)} new properties. Owned parcels, repeats in the file, and rows that need review are not changed.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-border p-3">
          <dt className="text-xs text-muted-foreground">New properties (saved)</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{formatCount(counts.newRows)}</dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-xs text-muted-foreground">Already owned (skipped)</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{formatCount(counts.existing)}</dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-xs text-muted-foreground">Repeated in file (skipped)</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{formatCount(counts.duplicate)}</dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-xs text-muted-foreground">Invalid or missing APN (skipped)</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{formatCount(counts.invalid + counts.missingApn)}</dd>
        </div>
      </dl>

      <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-end">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          Purchase date
          <input
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            className="field"
            required
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary h-10"
            onClick={() => save.mutate()}
            disabled={!dateValid || counts.newRows === 0 || save.isPending || save.isSuccess}
          >
            <Save size={16} aria-hidden="true" /> Save {formatCount(counts.newRows)} new properties
          </button>
          <span className="text-xs text-muted-foreground">Saved rows are kept. The import history records every run.</span>
        </div>
      </div>

      {progress && (
        <p className="text-sm" aria-live="polite">
          Saving… {formatCount(progress.done)} of {formatCount(progress.total)}
        </p>
      )}

      {save.isError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {save.error instanceof Error ? save.error.message : 'The import could not be saved.'}
        </p>
      )}

      {save.isSuccess && (
        <div role="status" className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          Saved {formatCount(save.data.committed)} properties.
          {save.data.failed > 0 && (
            <>
              {' '}
              {formatCount(save.data.failed)} rows could not be saved
              {save.data.firstError ? `: ${save.data.firstError}` : '.'}
            </>
          )}{' '}
          {save.data.phonesLinked > 0 && <> {formatCount(save.data.phonesLinked)} phone links saved. {formatCount(save.data.dncNumbers)} numbers marked Do Not Call. Exports do not check this flag yet.</>}
          {save.data.phoneError && <> Phone numbers could not be saved: {save.data.phoneError}</>}
          The batch is in the import history below.
        </div>
      )}
    </section>
  );
}
