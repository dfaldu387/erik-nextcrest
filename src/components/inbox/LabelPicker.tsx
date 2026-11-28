import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface LabelPickerProps {
  /** The conversation this picker belongs to, for screen readers. */
  label: string;
  /** Labels the conversation has now. */
  labels: string[];
  /** Every label the account can use. */
  options: string[];
  disabled?: boolean;
  /** Called with the full new list of labels. The parent saves it. */
  onChange: (labels: string[]) => void;
}

/** The labels of one conversation, shown as chips. Opens a list of checkboxes to add or remove labels. */
export function LabelPicker({ label, labels, options, disabled = false, onChange }: LabelPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The account's labels first, then any label on the conversation that the list does not have.
  const all = Array.from(new Set([...options, ...labels]));

  const toggle = (name: string) => {
    onChange(labels.includes(name) ? labels.filter((x) => x !== name) : [...labels, name]);
  };

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Labels for ${label}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-[260px] flex-wrap items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-muted disabled:opacity-60"
      >
        {labels.length === 0 ? (
          <span className="text-xs text-muted-foreground">Add label</span>
        ) : (
          labels.map((name) => (
            <span key={name} className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
              {name}
            </span>
          ))
        )}
        {open ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
      </button>

      {open && (
        <div
          role="group"
          aria-label={`Choose labels for ${label}`}
          className="absolute left-0 z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-[12px] border border-border bg-card p-2 shadow-lg"
        >
          {all.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">No labels in this account.</p>
          ) : (
            all.map((name) => (
              <label key={name} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                <input type="checkbox" checked={labels.includes(name)} disabled={disabled} onChange={() => toggle(name)} className="h-4 w-4" />
                <span>{name}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
