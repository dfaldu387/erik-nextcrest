import { Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { validateFilterName } from '@/lib/savedFilters';
import type { SavedFilterRecord } from '@/services/nextcrestData';

interface SavedFiltersBarProps {
  records: SavedFilterRecord[];
  loading: boolean;
  error: string | null;
  userId: string | null;
  loadedName: string | null;
  saving: boolean;
  deleting: boolean;
  message: { tone: 'ok' | 'error'; text: string } | null;
  onLoad: (record: SavedFilterRecord) => void;
  onSave: (name: string) => void;
  onDelete: (record: SavedFilterRecord) => void;
}

// One compact row: pick a saved filter to load it, save the current form under a name, or delete your own filter.
export function SavedFiltersBar({ records, loading, error, userId, loadedName, saving, deleting, message, onLoad, onSave, onDelete }: SavedFiltersBarProps) {
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const nameError = name.trim() ? validateFilterName(name) : null;
  const selected = records.find((r) => r.id === selectedId) ?? null;

  return (
    <section aria-labelledby="saved-heading" className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="saved-heading" className="text-sm font-semibold">Saved filters</h2>
        <p className="text-xs text-muted-foreground">
          {loadedName ? <>Loaded: <span className="font-medium text-foreground">{loadedName}</span></> : 'Shared with your team'}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          Load a saved filter
          <div className="flex gap-2">
            <SearchableSelect
              className="min-w-0 flex-1"
              value={selectedId}
              onChange={(id) => {
                setSelectedId(id);
                const record = records.find((r) => r.id === id);
                if (record) onLoad(record);
              }}
              options={records.map((r) => ({ value: r.id, label: r.name }))}
              placeholder={loading ? 'Loading…' : error ? 'Could not load saved filters' : records.length === 0 ? 'No saved filters yet' : 'Choose a saved filter'}
              ariaLabel="Load a saved filter"
              disabled={loading || error !== null || records.length === 0}
            />
            <button
              type="button"
              aria-label={selected ? `Delete saved filter ${selected.name}` : 'Delete saved filter'}
              disabled={!selected || selected.created_by !== userId || deleting}
              onClick={() => selected && onDelete(selected)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border text-muted-foreground hover:bg-red-50 hover:text-danger disabled:opacity-40"
              title={selected && selected.created_by !== userId ? 'Only the person who saved this filter can delete it' : 'Delete this saved filter'}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        </label>

        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs font-medium text-muted-foreground md:w-56">
            Save current filters as
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lafayette vacant lots" className="field" maxLength={80} />
          </label>
          <button
            type="button"
            className="btn-secondary h-9 self-end"
            disabled={!!nameError || !name.trim() || saving}
            onClick={() => {
              onSave(name.trim());
              setName('');
            }}
          >
            <Save size={14} aria-hidden="true" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {nameError && <p className="text-xs text-red-700 dark:text-red-300">{nameError}</p>}
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
      {message && (
        <p role="status" className={`text-xs ${message.tone === 'ok' ? 'text-success' : 'text-red-700 dark:text-red-300'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
