import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CommitResult } from '@/services/nextcrestData';

// A property import that runs in the background. It is started from the Import page, but it is not tied to that page:
// it keeps going while the user works elsewhere, and the progress bar in the app shell shows it on every page.
// It runs in this browser tab, so the tab must stay open until it finishes.

export type ImportJobState =
  | { status: 'idle' }
  | { status: 'running'; label: string; done: number; total: number }
  | { status: 'done'; label: string; done: number; total: number; result: CommitResult }
  | { status: 'error'; label: string; done: number; total: number; message: string };

interface ImportJobContextValue {
  state: ImportJobState;
  /** Starts a job. Returns false, and does nothing, when another import is already running. */
  start: (label: string, total: number, run: (onProgress: (done: number, total: number) => void) => Promise<CommitResult>) => boolean;
  dismiss: () => void;
}

const ImportJobContext = createContext<ImportJobContextValue | null>(null);

function refreshAfterImport(queryClient: QueryClient) {
  for (const key of ['import-batches', 'records', 'properties', 'property-filter-options', 'lead-groups', 'marketing-split', 'dashboard-summary']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function ImportJobProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ImportJobState>({ status: 'idle' });
  const running = useRef(false);

  const start = useCallback<ImportJobContextValue['start']>(
    (label, total, run) => {
      if (running.current) return false;
      running.current = true;
      setState({ status: 'running', label, done: 0, total });
      const onProgress = (done: number, of: number) =>
        setState((prev) => (prev.status === 'running' ? { ...prev, done, total: of } : prev));
      run(onProgress)
        .then((result) => {
          setState({ status: 'done', label, done: result.committed + result.failed, total, result });
        })
        .catch((error: unknown) => {
          setState({
            status: 'error',
            label,
            done: 0,
            total,
            message: error instanceof Error ? error.message : 'The import stopped unexpectedly.',
          });
        })
        .finally(() => {
          running.current = false;
          refreshAfterImport(queryClient);
        });
      return true;
    },
    [queryClient],
  );

  const dismiss = useCallback(() => {
    if (!running.current) setState({ status: 'idle' });
  }, []);

  // Warn before the tab closes while rows are still being saved.
  useEffect(() => {
    if (state.status !== 'running') return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.status]);

  const value = useMemo(() => ({ state, start, dismiss }), [state, start, dismiss]);
  return <ImportJobContext.Provider value={value}>{children}</ImportJobContext.Provider>;
}

export function useImportJob(): ImportJobContextValue {
  const value = useContext(ImportJobContext);
  if (!value) throw new Error('useImportJob must be used inside ImportJobProvider');
  return value;
}

/** The share of rows saved so far, from 0 to 100. */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}
