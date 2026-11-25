import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitMerge, Search, X } from 'lucide-react';
import { useState } from 'react';
import type { LandRecord } from '@/data/types';
import { formatCount } from '@/lib/format';
import { mergeProperties, searchProperties } from '@/services/nextcrestData';

const MIN_SEARCH = 3;

interface PickerProps {
  label: string;
  hint: string;
  selected: LandRecord | null;
  onSelect: (record: LandRecord | null) => void;
  excludeId?: string;
}

// Search box that finds a property by APN, owner, county or phone and lets you pick one.
function PropertyPicker({ label, hint, selected, onSelect, excludeId }: PickerProps) {
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const results = useQuery({
    queryKey: ['merge-search', submitted],
    enabled: submitted.length >= MIN_SEARCH,
    queryFn: () =>
      searchProperties({ search: submitted, status: '', state: '', county: '', sort: 'apn', dir: 'asc', page: 1, pageSize: 8 }),
  });

  const rows = (results.data?.rows ?? []).filter((r) => r.id !== excludeId);

  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <p className="text-xs text-muted-foreground">{hint}</p>

      {selected ? (
        <div className="flex items-start justify-between gap-2 rounded-md bg-muted/40 p-3">
          <div className="min-w-0 text-sm">
            <div className="truncate font-medium">{selected.ownerName || 'No owner name'}</div>
            <div className="font-mono text-xs text-muted-foreground">
              APN {selected.apn} · {selected.county}, {selected.state} · {selected.acres} ac
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost h-8 w-8 shrink-0 p-0"
            aria-label={`Clear ${label}`}
            title="Clear selection"
            onClick={() => onSelect(null)}
          >
            <X className="mx-auto h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(term.trim());
            }}
          >
            <input
              className="field flex-1"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="APN, owner, county or phone"
              aria-label={`Search for ${label}`}
            />
            <button type="submit" className="btn-secondary h-10 w-10 p-0" aria-label={`Search ${label}`} title="Search">
              <Search className="mx-auto h-4 w-4" aria-hidden="true" />
            </button>
          </form>
          {submitted.length > 0 && submitted.length < MIN_SEARCH && (
            <p className="text-xs text-muted-foreground">Type at least {MIN_SEARCH} characters.</p>
          )}
          {results.isFetching && <p className="text-xs text-muted-foreground">Searching…</p>}
          {submitted.length >= MIN_SEARCH && !results.isFetching && rows.length === 0 && (
            <p className="text-xs text-muted-foreground">No properties match “{submitted}”.</p>
          )}
          {rows.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40"
                    onClick={() => onSelect(r)}
                  >
                    <span className="min-w-0 truncate">{r.ownerName || 'No owner name'}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {r.apn} · {r.county}, {r.state}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </fieldset>
  );
}

// Merges a duplicate property into the one you keep. The removed property's full record is saved first.
export function MergePanel() {
  const queryClient = useQueryClient();
  const [keep, setKeep] = useState<LandRecord | null>(null);
  const [remove, setRemove] = useState<LandRecord | null>(null);
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const merge = useMutation({
    mutationFn: () => mergeProperties({ keepId: keep!.id, removeId: remove!.id, notes }),
    onMutate: () => {
      setError(null);
      setResult(null);
    },
    onSuccess: (r) => {
      setResult(
        `Merged. ${formatCount(r.owners_moved)} owners, ${formatCount(r.phones_moved)} phone links and ${formatCount(r.dataset_records_moved + r.marketing_rows_moved)} history rows moved to the kept property. The removed record is saved in merge history.`,
      );
      setKeep(null);
      setRemove(null);
      setNotes('');
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'The properties could not be merged.'),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['records'] });
      void queryClient.invalidateQueries({ queryKey: ['properties'] });
      void queryClient.invalidateQueries({ queryKey: ['merge-search'] });
    },
  });

  const canMerge = Boolean(keep && remove && keep.id !== remove.id);

  function confirmMerge() {
    if (!keep || !remove) return;
    const ok = window.confirm(
      `Merge the duplicate into the kept property?\n\nKeep: APN ${keep.apn} (${keep.ownerName || 'no owner'})\nRemove: APN ${remove.apn} (${remove.ownerName || 'no owner'})\n\nThe removed property's full record is saved in merge history. Its phone links and history move to the kept property.`,
    );
    if (ok) merge.mutate();
  }

  return (
    <section aria-labelledby="merge-heading" className="card space-y-4 p-5">
      <div>
        <h2 id="merge-heading" className="flex items-center gap-2 text-base font-semibold">
          <GitMerge className="h-4 w-4" aria-hidden="true" />
          Merge duplicate properties
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose the property to keep and the duplicate to remove. Blank details on the kept property are filled from the duplicate. Nothing that is already filled is overwritten.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <PropertyPicker
          label="Keep"
          hint="This property stays, with its history."
          selected={keep}
          onSelect={setKeep}
          excludeId={remove?.id}
        />
        <PropertyPicker
          label="Remove (merge into kept)"
          hint="This duplicate is removed. Its full record is saved first."
          selected={remove}
          onSelect={setRemove}
          excludeId={keep?.id}
        />
      </div>

      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
        Notes (optional)
        <textarea
          className="field min-h-[60px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Why these are the same property"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary h-10 gap-2" disabled={!canMerge || merge.isPending} onClick={confirmMerge}>
          <GitMerge className="h-4 w-4" aria-hidden="true" />
          {merge.isPending ? 'Merging…' : 'Merge properties'}
        </button>
        {result && (
          <p role="status" className="text-sm text-green-800 dark:text-green-300">
            {result}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
