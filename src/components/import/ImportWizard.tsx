import { ArrowLeft, ArrowRight, Download, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CommitPanel } from '@/components/import/CommitPanel';
import { Dropzone } from '@/components/ui/Dropzone';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useRecordsQuery } from '@/hooks/useNextCrestData';
import { downloadCsv, parseCsv, toCsv } from '@/lib/csv';
import { buildOwnedIndex } from '@/lib/duplicates';
import { formatCount } from '@/lib/format';
import { autoMap } from '@/lib/autoMap';
import { MAPPING_TARGETS, isMappingComplete } from '@/lib/importMapping';
import type { Mapping } from '@/lib/importMapping';
import { reviewBatch, summarizeBatch } from '@/lib/importReview';
import type { BatchFile, ReviewRow } from '@/lib/importReview';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 50;
const STEPS = ['Upload', 'Preview', 'Map fields', 'Review'] as const;

interface StagedFile {
  name: string;
  table: string[][];
  mapping: Mapping;
}

export function ImportWizard() {
  const { data } = useRecordsQuery();
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [activeFile, setActiveFile] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const owned = useMemo(() => buildOwnedIndex(data?.data ?? []), [data]);
  const allMapped = files.length > 0 && files.every((f) => isMappingComplete(f.mapping));

  const batch: BatchFile[] = files.map((f) => ({ name: f.name, table: f.table, mapping: f.mapping }));
  const reviewed: ReviewRow[] = useMemo(() => (step === 3 ? reviewBatch(batch, owned) : []), [step, files, owned]);
  const summary = useMemo(() => summarizeBatch(reviewed), [reviewed]);

  const onFiles = async (picked: File[]) => {
    setMessage(null);
    if (picked.length > MAX_FILES) {
      setMessage(`Choose up to ${MAX_FILES} files at a time.`);
      return;
    }
    setLoading(true);
    try {
      const staged: StagedFile[] = [];
      for (const f of picked) {
        const table = parseCsv(await f.text());
        if (table.length < 2) {
          setMessage(`${f.name} needs a header row and at least one property row.`);
          return;
        }
        staged.push({ name: f.name, table, mapping: autoMap(table[0], table.slice(1)).mapping });
      }
      setFiles(staged);
      setActiveFile(0);
      setStep(1);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFiles([]);
    setActiveFile(0);
    setMessage(null);
    setStep(0);
  };

  // Drops one staged file before saving. Removing the last file goes back to the upload step.
  const discardFile = (index: number) => {
    if (files.length <= 1) {
      reset();
      return;
    }
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setActiveFile((a) => Math.max(0, Math.min(index < a ? a - 1 : a, files.length - 2)));
  };

  const updateMapping = (index: number, key: keyof Mapping, value: number) =>
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, mapping: { ...f.mapping, [key]: value } } : f)));

  const downloadCleaned = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const rows = reviewed.map((r) => [
      r.source,
      r.apn,
      r.state,
      r.county,
      r.fips,
      r.ownerName,
      r.isEntity ? 'Organization' : r.ownerName ? 'Individual' : '',
      r.withinBatchDuplicate ? 'Repeated in batch' : r.status,
      r.reason,
    ]);
    downloadCsv(
      `cleaned_batch_${stamp}.csv`,
      toCsv(['Source file', 'APN', 'State', 'County', 'FIPS', 'Owner', 'Owner type', 'Result', 'Reason'], rows),
    );
  };

  const canGoNext =
    step === 0 ? false : step === 1 ? files.length > 0 : step === 2 ? allMapped : false;

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label="Import steps">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? 'step' : undefined}
            className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
              index === step
                ? 'bg-primary text-primary-foreground'
                : index < step
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            <span className="tabular-nums">{index + 1}</span> {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="card p-5">
          <Dropzone accept=".csv,text/csv" maxBytes={MAX_BYTES} onFiles={onFiles} onError={setMessage} multiple />
          <p className="mt-4 text-xs text-muted-foreground">
            CSV files only, up to {MAX_FILES} at a time. Each file can have its own column layout. Excel and Land Portal API pulls come later.
          </p>
          {loading && <p className="mt-3 text-sm text-muted-foreground">Reading files…</p>}
          {message && (
            <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
              {message}
            </p>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{files.length} file{files.length === 1 ? '' : 's'} ready</h2>
            <p className="text-sm text-muted-foreground">
              {formatCount(files.reduce((sum, f) => sum + f.table.length - 1, 0))} rows in total
            </p>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[480px] text-left text-sm">
              <caption className="sr-only">Files selected for import</caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">File</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Rows</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Columns</th>
                  <th scope="col" className="px-3 py-2 font-medium">Mapped</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    <span className="sr-only">Discard</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {files.map((f, index) => (
                  <tr key={f.name} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">{f.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCount(f.table.length - 1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCount(f.table[0].length)}</td>
                    <td className="px-3 py-2">{isMappingComplete(f.mapping) ? 'Yes' : 'Needs fields mapped'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="btn-ghost h-8 w-8 p-0 text-red-700 dark:text-red-300"
                        aria-label={`Discard ${f.name}`}
                        title="Discard this file"
                        onClick={() => discardFile(index)}
                      >
                        <Trash2 className="mx-auto h-4 w-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn-ghost" onClick={reset}>
            Remove all and choose different files
          </button>
        </div>
      )}

      {step === 2 && files.length > 0 && (
        <div className="card space-y-4 p-5">
          <div role="tablist" aria-label="Files" className="flex gap-1 overflow-x-auto border-b border-border">
            {files.map((f, index) => (
              <button
                key={f.name}
                role="tab"
                type="button"
                aria-selected={index === activeFile}
                onClick={() => setActiveFile(index)}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                  index === activeFile ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {f.name}
                {!isMappingComplete(f.mapping) && <span className="ml-1 text-amber-600">•</span>}
              </button>
            ))}
          </div>

          <p className="text-sm text-muted-foreground">
            Columns were matched from their values, so check them before continuing. Fields marked with * are required.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {MAPPING_TARGETS.map((t) => (
              <label key={t.key} className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                <span>
                  {t.label}
                  {t.required && <span className="text-red-600"> *</span>}
                </span>
                <select
                  className="field w-full"
                  value={files[activeFile].mapping[t.key]}
                  onChange={(e) => updateMapping(activeFile, t.key, Number(e.target.value))}
                >
                  <option value={-1}>Not in this file</option>
                  {files[activeFile].table[0].map((h, index) => (
                    <option key={`${h}-${index}`} value={index}>
                      {h.trim() || `Column ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {!isMappingComplete(files[activeFile].mapping) && (
            <p className="text-sm text-amber-700 dark:text-amber-300">Map APN, State and County to continue.</p>
          )}
          <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
            Saving mapping templates for reuse needs the database, so they are not stored yet.
          </p>
        </div>
      )}

      {step === 3 && files.length > 0 && (
        <div className="space-y-6">
          <CommitPanel files={batch} reviewed={reviewed} summary={summary} filename={files.map((f) => f.name).join(', ')} />
          <div className="card space-y-4 p-5">
            <h2 className="text-base font-semibold">Batch duplicate check</h2>
            {(data?.data.length ?? 0) === 0 && (
              <p className="text-sm text-amber-800 dark:text-amber-300">
                The database has no properties yet, so only duplicates within these files can be found.
              </p>
            )}
            <ProgressBar
              value={summary.total ? Math.round(((summary.owned + summary.withinBatchDuplicate) / summary.total) * 100) : 0}
              label="Rows already owned or repeated in this batch"
              tone="amber"
            />
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="New properties" value={formatCount(summary.new)} />
              <Stat label="Already owned" value={formatCount(summary.owned)} />
              <Stat label="Repeated across files" value={formatCount(summary.withinBatchDuplicate)} />
              <Stat label="Invalid or missing APN" value={formatCount(summary.invalid)} />
              <Stat label="Need review" value={formatCount(summary.review)} />
              <Stat label="FIPS not in file" value={formatCount(summary.fipsMissing)} />
              <Stat label="Organization owners" value={formatCount(summary.entities)} />
              <Stat label="Total rows" value={formatCount(summary.total)} />
            </dl>
            {summary.fipsMissing > 0 && (
              <p className="text-xs text-muted-foreground">
                Rows without a FIPS code are checked by county and state for now. They can't be stored by FIPS + APN until a county-to-FIPS lookup is added.
              </p>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="p-4">
              <h2 className="text-base font-semibold">Per file</h2>
            </div>
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full min-w-[560px] text-left text-sm">
                <caption className="sr-only">Results per file</caption>
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-2 py-2 font-medium">File</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Rows</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">New</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Owned</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Repeated</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Invalid</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => {
                    const rows = reviewed.filter((r) => r.source === f.name);
                    const s = summarizeBatch(rows);
                    return (
                      <tr key={f.name} className="border-b border-border last:border-0">
                        <td className="px-2 py-2 font-medium">{f.name}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatCount(s.total)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatCount(s.new)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatCount(s.owned)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatCount(s.withinBatchDuplicate)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatCount(s.invalid)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">Preview of cleaned rows</h2>
                <p className="text-xs text-muted-foreground">First 10 of {formatCount(reviewed.length)} rows across all files.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={downloadCleaned} disabled={reviewed.length === 0}>
                  <Download size={16} aria-hidden="true" /> Download cleaned file
                </button>
                <button type="button" className="btn-primary" disabled title="Saving to the database needs the database connection">
                  Import {formatCount(summary.new)} new records
                </button>
              </div>
            </div>
            <p className="px-4 pt-3 text-xs text-muted-foreground">
              Import to the database is disabled until the database is connected. The cleaned file can be downloaded now.
            </p>
            <div className="overflow-x-auto p-4">
              <table className="w-full min-w-[640px] text-left text-xs">
                <caption className="sr-only">Cleaned rows preview</caption>
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className="px-2 py-2 font-medium">Source</th>
                    <th scope="col" className="px-2 py-2 font-medium">APN</th>
                    <th scope="col" className="px-2 py-2 font-medium">County · State</th>
                    <th scope="col" className="px-2 py-2 font-medium">Owner</th>
                    <th scope="col" className="px-2 py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewed.slice(0, 10).map((row, index) => (
                    <tr key={index} className="border-b border-border last:border-0">
                      <td className="px-2 py-2">{row.source}</td>
                      <td className="px-2 py-2 font-mono">{row.apn || '—'}</td>
                      <td className="px-2 py-2">{row.county ? `${row.county}, ${row.state}` : '—'}</td>
                      <td className="px-2 py-2">{row.ownerName || '—'}</td>
                      <td className="px-2 py-2">
                        <ResultLabel row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => (step === 0 ? reset() : setStep(step - 1))}
          disabled={step === 0 && files.length === 0}
        >
          <ArrowLeft size={16} aria-hidden="true" /> {step === 0 ? 'Start over' : 'Back'}
        </button>
        {step >= 1 && step < 3 && (
          <button type="button" className="btn-primary" onClick={() => setStep(step + 1)} disabled={!canGoNext}>
            Next <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
        {step === 3 && (
          <button type="button" className="btn-ghost" onClick={reset}>
            Import other files
          </button>
        )}
      </div>
    </div>
  );
}

function ResultLabel({ row }: { row: ReviewRow }): ReactNode {
  if (row.withinBatchDuplicate) return <span className="text-amber-800 dark:text-amber-300">Repeated, first in {row.firstSeenIn}</span>;
  if (row.status === 'owned') return <span className="text-green-800 dark:text-green-300">Already owned</span>;
  if (row.status === 'new') return <span className="text-blue-800 dark:text-blue-300">New property</span>;
  return <span className="text-amber-800 dark:text-amber-300">{row.reason}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
