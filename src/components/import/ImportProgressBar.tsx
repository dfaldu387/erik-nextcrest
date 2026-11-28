import { X } from 'lucide-react';
import { formatCount } from '@/lib/format';
import { progressPercent, useImportJob } from '@/lib/importJobs';

/** Shows the background import's row count and progress across the top of every page. Hidden when no import has run. */
export function ImportProgressBar() {
  const { state, dismiss } = useImportJob();
  if (state.status === 'idle') return null;

  const percent = progressPercent(state.done, state.total);
  const counts = `${formatCount(state.done)} of ${formatCount(state.total)} rows imported`;

  if (state.status === 'running') {
    return (
      <div role="status" aria-live="polite" className="border-b border-border bg-card px-4 py-2">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium">{counts}</span>
          <span className="tabular-nums text-muted-foreground">{percent}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Rows imported"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 border-b border-red-300 bg-red-50 px-4 py-2 text-xs text-red-900 dark:bg-red-950 dark:text-red-200">
        <span>Import stopped: {state.message}</span>
        <button type="button" onClick={dismiss} aria-label="Dismiss import status" className="rounded p-1 hover:bg-black/5">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div role="status" className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2 text-xs">
      <span className="font-medium">{counts}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss import status" className="rounded p-1 hover:bg-black/5">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
