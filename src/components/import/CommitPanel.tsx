import { Save } from 'lucide-react';
import { useState } from 'react';
import { toRawCsv } from '@/lib/csv';
import { buildCommitPhones, buildCommitRows, countsFrom } from '@/lib/importCommit';
import { useImportJob } from '@/lib/importJobs';
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
// The save runs in the background: the progress bar across the top of the app shows it, and the page can be left.
export function CommitPanel({ files, reviewed, summary, filename }: CommitPanelProps) {
  const { state, start } = useImportJob();
  const [purchaseDate, setPurchaseDate] = useState(todayIso);
  const [started, setStarted] = useState(false);
  const counts = countsFrom(summary, reviewed);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(purchaseDate);

  const anyRunning = state.status === 'running';
  const thisBatchRunning = anyRunning && state.label === filename;
  const saved = started && state.status === 'done' && state.label === filename;

  const save = () => {
    const accepted = start(filename, counts.newRows, (onProgress) =>
      commitImport({
        filename,
        purchaseDate,
        counts,
        buildRows: (batchId) => buildCommitRows(files, reviewed, purchaseDate, batchId),
        phones: buildCommitPhones(files, reviewed),
        sourceFiles: files.map((f) => ({ name: f.name, csv: toRawCsv(f.table) })),
        onProgress,
      }),
    );
    if (accepted) setStarted(true);
  };

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
            onClick={save}
            disabled={!dateValid || counts.newRows === 0 || anyRunning || saved}
          >
            <Save size={16} aria-hidden="true" />{' '}
            {thisBatchRunning ? 'Saving in background…' : saved ? 'Saved' : `Save ${formatCount(counts.newRows)} new properties`}
          </button>
          <span className="text-xs text-muted-foreground">
            Runs in the background, with progress shown across the top of the screen. Keep this tab open until it finishes.
          </span>
        </div>
      </div>

      {saved && state.status === 'done' && (
        <p role="status" className="text-sm text-green-800 dark:text-green-200">
          Saved {formatCount(state.result.committed)} properties. The batch is in the import history below.
        </p>
      )}
    </section>
  );
}
