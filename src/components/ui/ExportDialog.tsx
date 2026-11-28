import { useState } from 'react';

export interface ExportColumn {
  key: string;
  label: string;
}

interface ExportDialogProps {
  title: string;
  description: string;
  columns: ExportColumn[];
  /** Labels to filter by. Leave empty to export everything that matches the current filters. */
  labelOptions?: string[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onExport: (choice: { columns: string[]; labels: string[] }) => void;
}

/** Choose the columns (and optionally the labels) to export. The parent mounts it only while it is open. */
export function ExportDialog({ title, description, columns, labelOptions, busy, error, onClose, onExport }: ExportDialogProps) {
  const [picked, setPicked] = useState<string[]>(() => columns.map((c) => c.key));
  const [labels, setLabels] = useState<string[]>([]);

  const toggle = (list: string[], set: (next: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onClose();
      }}
    >
      <div className="card w-full max-w-md space-y-5 p-6">
        <div>
          <h2 id="export-dialog-title" className="text-base font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>

        {labelOptions && labelOptions.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Labels</legend>
            <p className="text-xs text-muted-foreground">Export only properties with any of these labels. Leave all unticked for every property.</p>
            <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
              {labelOptions.map((name) => (
                <label key={name} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={labels.includes(name)} onChange={() => toggle(labels, setLabels, name)} className="h-4 w-4" />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Columns</legend>
          <div className="flex gap-3 text-xs">
            <button type="button" className="text-primary hover:underline" onClick={() => setPicked(columns.map((c) => c.key))}>Select all</button>
            <button type="button" className="text-primary hover:underline" onClick={() => setPicked([])}>Clear</button>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            {columns.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={picked.includes(c.key)} onChange={() => toggle(picked, setPicked, c.key)} className="h-4 w-4" />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="rounded-[10px] border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || picked.length === 0}
            onClick={() => onExport({ columns: columns.map((c) => c.key).filter((k) => picked.includes(k)), labels })}
          >
            {busy ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>
    </div>
  );
}
