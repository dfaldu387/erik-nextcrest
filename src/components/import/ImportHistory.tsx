import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/ui/DataTable';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { downloadCsv } from '@/lib/csv';
import { formatCount, formatDate, formatTime } from '@/lib/format';
import {
  discardImportBatch,
  getImportBatchFiles,
  type ImportBatchRecord,
  listImportBatches,
} from '@/services/nextcrestData';

const STATUS_LABEL: Record<ImportBatchRecord['status'], string> = {
  processing: 'Processing',
  completed: 'Completed',
  completed_with_errors: 'Completed with errors',
  failed: 'Failed',
};

const COLUMNS: Column<ImportBatchRecord>[] = [
  {
    key: 'imported',
    header: 'Imported',
    cell: (b) => <span className="whitespace-nowrap text-xs">{formatTime(b.created_at)}</span>,
    sortValue: (b) => b.created_at,
  },
  {
    key: 'file',
    header: 'File',
    cell: (b) => <span className="font-mono text-xs">{b.filename}</span>,
    sortValue: (b) => b.filename,
    searchValue: (b) => b.filename,
  },
  {
    key: 'purchase',
    header: 'Purchase date',
    cell: (b) => formatDate(b.purchase_date),
    hideBelow: 'md',
    sortValue: (b) => b.purchase_date,
  },
  {
    key: 'total',
    header: 'Rows',
    cell: (b) => <span className="tabular-nums">{formatCount(b.total_rows)}</span>,
    sortValue: (b) => b.total_rows,
  },
  {
    key: 'new',
    header: 'New saved',
    cell: (b) => <span className="tabular-nums">{formatCount(b.committed_rows)}</span>,
    sortValue: (b) => b.committed_rows,
    hideBelow: 'md',
  },
  {
    key: 'skipped',
    header: 'Skipped',
    cell: (b) => (
      <span className="tabular-nums text-muted-foreground">
        {formatCount(b.existing_rows + b.duplicate_rows + b.invalid_rows + b.missing_apn_rows)}
      </span>
    ),
    sortValue: (b) => b.existing_rows + b.duplicate_rows + b.invalid_rows + b.missing_apn_rows,
    hideBelow: 'lg',
  },
  {
    key: 'status',
    header: 'Status',
    cell: (b) => (
      <span className={b.status === 'completed' ? 'text-green-800 dark:text-green-300' : 'text-amber-800 dark:text-amber-300'}>
        {STATUS_LABEL[b.status]}
      </span>
    ),
    sortValue: (b) => b.status,
  },
];

export function ImportHistory() {
  const queryClient = useQueryClient();
  const batches = useQuery({ queryKey: ['import-batches'], queryFn: () => listImportBatches() });
  const [actionError, setActionError] = useState<string | null>(null);

  const download = useMutation({
    mutationFn: (batch: ImportBatchRecord) => getImportBatchFiles(batch.id),
    onMutate: () => setActionError(null),
    onSuccess: (files) => {
      for (const file of files) downloadCsv(file.name.endsWith('.csv') ? file.name : `${file.name}.csv`, file.csv);
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : 'The file could not be downloaded.'),
  });

  const discard = useMutation({
    mutationFn: (batch: ImportBatchRecord) => discardImportBatch(batch.id),
    onMutate: () => setActionError(null),
    onError: (error) => setActionError(error instanceof Error ? error.message : 'The import could not be removed.'),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['import-batches'] });
      void queryClient.invalidateQueries({ queryKey: ['records'] });
      void queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
  });

  function confirmDiscard(batch: ImportBatchRecord) {
    const ok = window.confirm(
      `Discard the import "${batch.filename}"?\n\nIts ${formatCount(batch.committed_rows)} saved properties, their owners and phone links will be deleted. This cannot be undone from the app.`,
    );
    if (ok) discard.mutate(batch);
  }

  const actionsColumn: Column<ImportBatchRecord> = {
    key: 'actions',
    header: 'Actions',
    cell: (b) => (
      <div className="flex justify-end gap-1 whitespace-nowrap">
        <button
          type="button"
          className="btn-ghost h-8 w-8 p-0"
          disabled={!b.has_source_file || download.isPending}
          aria-label={`Download ${b.filename}`}
          title={b.has_source_file ? 'Download the uploaded file' : 'No file was saved for this import'}
          onClick={() => download.mutate(b)}
        >
          <Download className="mx-auto h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn-ghost h-8 w-8 p-0 text-red-700 dark:text-red-300"
          disabled={discard.isPending}
          aria-label={`Discard ${b.filename}`}
          title="Discard this import"
          onClick={() => confirmDiscard(b)}
        >
          <Trash2 className="mx-auto h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    ),
  };
  const columns = [...COLUMNS, actionsColumn];

  return (
    <section aria-labelledby="import-history-heading" className="card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 id="import-history-heading" className="text-sm font-semibold">
          Import history
        </h2>
        <p className="text-xs text-muted-foreground">Every purchase file saved to the database, newest first.</p>
      </div>
      {actionError ? (
        <p role="alert" className="border-b border-border px-4 py-2 text-xs text-red-700 dark:text-red-300">
          {actionError}
        </p>
      ) : null}
      {batches.isError ? (
        <div className="p-4">
          <ErrorState message="Import history could not be loaded." onRetry={() => batches.refetch()} />
        </div>
      ) : (
        <DataTable<ImportBatchRecord>
          caption="Import history"
          isLoading={batches.isPending}
          rows={batches.data ?? []}
          rowKey={(b) => b.id}
          columns={columns}
          defaultSort={{ key: 'imported', dir: 'desc' }}
          defaultPageSize={10}
          searchPlaceholder="Search file names"
          empty={<EmptyState title="No imports yet" description="Each purchase file you save appears here." />}
        />
      )}
    </section>
  );
}
