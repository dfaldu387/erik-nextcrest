import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { DateRangePicker } from '@/components/inbox/DateRangePicker';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import { dateRangeError, PROPERTY_MATCH_OPTIONS, type InboxFilters, type MatchMode } from '@/lib/inboxFilters';

interface InboxFilterDialogProps {
  value: InboxFilters;
  labelOptions: string[];
  areaCodeOptions: string[];
  onApply: (next: InboxFilters) => void;
  onClose: () => void;
}

const NOT_SHARED = 'SmarterContact does not share this through the connector yet.';

type SectionKey = 'labels' | 'responseDate' | 'areaCode' | 'property' | 'campaigns' | 'groups';

// A collapsible section with a chevron, as in SmarterContact.
function Accordion({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center justify-between py-4 text-left text-sm font-medium"
      >
        {title}
        {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
      </button>
      {open && <div className="space-y-3 pb-4">{children}</div>}
    </div>
  );
}

// A label row such as "Include contacts with [Any] of these labels".
function ModeRow({ prefix, mode, onMode, label }: { prefix: string; mode: MatchMode; onMode: (m: MatchMode) => void; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span>{prefix}</span>
      <select
        aria-label={label}
        value={mode}
        onChange={(e) => onMode(e.target.value as MatchMode)}
        className="field h-9 w-24 shrink-0 rounded-full py-0 text-sm"
      >
        <option value="any">Any</option>
        <option value="all">All</option>
      </select>
      <span>of these labels</span>
    </div>
  );
}

// Favorites and Closed deals are shown for parity, but cannot be set until the connector shares them.
function UnavailableToggle({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between border-t border-border py-4 text-sm font-medium">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={false}
        aria-label={label}
        disabled
        title={NOT_SHARED}
        className="relative h-6 w-11 rounded-full bg-border opacity-60"
      >
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white" />
      </button>
    </div>
  );
}

// The "Filter contacts" dialog. Choices are kept in a draft until Apply, so closing without applying changes nothing.
// The parent mounts it only while it is open, so each opening starts from the applied filters.
export function InboxFilterDialog({ value, labelOptions, areaCodeOptions, onApply, onClose }: InboxFilterDialogProps) {
  const [draft, setDraft] = useState<InboxFilters>(value);
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    labels: true,
    responseDate: true,
    areaCode: false,
    property: false,
    campaigns: false,
    groups: false,
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rangeError = dateRangeError(draft);
  const set = <K extends keyof InboxFilters>(key: K, next: InboxFilters[K]) => setDraft((prev) => ({ ...prev, [key]: next }));
  const toggle = (key: SectionKey) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
      onClick={(e) => {
        // Closes only when the backdrop itself is clicked. Mouse-down is not stopped, so an open picker still closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="inbox-filter-title" className="card flex max-h-[90vh] w-full max-w-md flex-col">
        <div className="relative border-b border-border px-6 py-4 text-center">
          <h2 id="inbox-filter-title" className="text-lg font-semibold">
            Filter contacts
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full p-1 hover:bg-accent">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6">
          <Accordion title="Labels" open={open.labels} onToggle={() => toggle('labels')}>
            <div className="space-y-4 rounded-xl bg-accent/40 p-4">
              <div className="space-y-2">
                <ModeRow prefix="Include contacts with" mode={draft.includeMode} onMode={(m) => set('includeMode', m)} label="Include mode" />
                <SearchableMultiSelect
                  ariaLabel="Include labels"
                  placeholder="Select label"
                  options={labelOptions}
                  value={draft.includeLabels}
                  onChange={(v) => set('includeLabels', v)}
                  searchIcon
                />
              </div>
              <div className="space-y-2 border-t border-border pt-4">
                <ModeRow prefix="Exclude contacts with" mode={draft.excludeMode} onMode={(m) => set('excludeMode', m)} label="Exclude mode" />
                <SearchableMultiSelect
                  ariaLabel="Exclude labels"
                  placeholder="Select label"
                  options={labelOptions}
                  value={draft.excludeLabels}
                  onChange={(v) => set('excludeLabels', v)}
                  searchIcon
                />
              </div>
            </div>
          </Accordion>

          <Accordion title="Response date" open={open.responseDate} onToggle={() => toggle('responseDate')}>
            <DateRangePicker
              from={draft.responseFrom}
              to={draft.responseTo}
              onChange={(from, to) => setDraft((prev) => ({ ...prev, responseFrom: from, responseTo: to }))}
            />
            {rangeError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{rangeError}</p>}
          </Accordion>

          <Accordion title="Area code" open={open.areaCode} onToggle={() => toggle('areaCode')}>
            <SearchableMultiSelect
              ariaLabel="Area code"
              placeholder="Search"
              options={areaCodeOptions}
              value={draft.areaCodes}
              onChange={(v) => set('areaCodes', v)}
              searchIcon
            />
          </Accordion>

          <Accordion title="Property match" open={open.property} onToggle={() => toggle('property')}>
            <select
              aria-label="Property match"
              value={draft.propertyMatch}
              onChange={(e) => set('propertyMatch', e.target.value as InboxFilters['propertyMatch'])}
              className="field w-full"
            >
              {PROPERTY_MATCH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <span className="whitespace-nowrap">At least</span>
              <input
                type="number"
                min={0}
                max={999}
                aria-label="Minimum number of properties"
                value={draft.minProperties}
                onChange={(e) => set('minProperties', Math.max(0, Math.min(999, Math.floor(Number(e.target.value) || 0))))}
                className="field w-24"
              />
              <span className="text-muted-foreground">properties (0 = any)</span>
            </label>
            <p className="text-xs text-muted-foreground">Matched means the conversation's phone, APN or owner is on an imported property.</p>
          </Accordion>

          <Accordion title="Campaigns" open={open.campaigns} onToggle={() => toggle('campaigns')}>
            <SearchableMultiSelect ariaLabel="Campaigns" placeholder="Select campaigns" options={[]} value={[]} onChange={() => undefined} searchIcon disabled />
            <p className="text-xs text-muted-foreground">Campaign names are not available from SmarterContact yet.</p>
          </Accordion>

          <Accordion title="Groups" open={open.groups} onToggle={() => toggle('groups')}>
            <SearchableMultiSelect ariaLabel="Groups" placeholder="Select groups" options={[]} value={[]} onChange={() => undefined} searchIcon disabled />
            <p className="text-xs text-muted-foreground">Group names are not available from SmarterContact yet.</p>
          </Accordion>

          <UnavailableToggle label="Favorites" />
          <UnavailableToggle label="Closed deals" />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            className="text-sm font-medium text-primary hover:underline"
            onClick={() =>
              setDraft({
                ...draft,
                includeLabels: [],
                includeMode: 'any',
                excludeLabels: [],
                excludeMode: 'any',
                responseFrom: '',
                responseTo: '',
                areaCodes: [],
                propertyMatch: 'any',
                minProperties: 0,
              })
            }
          >
            Reset
          </button>
          <div className="flex items-center gap-2">
            <button type="button" disabled title="Saving filters is not available yet" className="h-9 rounded-full border border-border px-4 text-sm opacity-50">
              Save filter
            </button>
            <button type="button" className="btn-primary h-9 rounded-full px-5" disabled={!!rangeError} onClick={() => onApply(draft)}>
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
