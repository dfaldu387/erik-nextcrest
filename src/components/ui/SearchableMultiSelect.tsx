import { ChevronDown, Check, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

interface SearchableMultiSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: string[];
  // Shown when nothing is selected, e.g. "Any ZIP code".
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  // Shows a magnifier instead of the chevron, as in the SmarterContact filter dialog.
  searchIcon?: boolean;
}

// A checklist dropdown with a search box. Several options can be ticked; the list stays open while you pick.
export function SearchableMultiSelect({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  disabled,
  className = '',
  searchIcon = false,
}: SearchableMultiSelectProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => (needle === '' ? options : options.filter((o) => o.toLowerCase().includes(needle))),
    [options, needle],
  );
  const activeIndex = Math.min(active, Math.max(shown.length - 1, 0));

  const summary =
    value.length === 0 ? placeholder : value.length <= 2 ? value.join(', ') : `${value.length} selected`;

  const openList = () => {
    if (disabled) return;
    setQuery('');
    setActive(0);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const toggle = (option: string) => {
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  };

  // Close when a click lands outside the control.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return openList();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.min(Math.max(activeIndex + step, 0), Math.max(shown.length - 1, 0)));
    } else if (event.key === 'Enter' && open && shown[activeIndex]) {
      event.preventDefault();
      toggle(shown[activeIndex]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close();
    }
  };

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <input
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[activeIndex] ? `${id}-${activeIndex}` : undefined}
        autoComplete="off"
        disabled={disabled}
        value={open ? query : summary}
        placeholder={summary}
        onFocus={() => {
          if (!open) openList();
        }}
        onClick={() => {
          if (!open) openList();
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="field w-full pr-8"
      />
      {searchIcon ? (
        <Search aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      ) : (
        <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      )}
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[12rem] overflow-hidden rounded-[10px] border border-border bg-card text-sm shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
            <span>{value.length} selected</span>
            <button
              type="button"
              disabled={value.length === 0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange([])}
              className="font-medium text-foreground hover:underline disabled:opacity-40 disabled:no-underline"
            >
              Clear
            </button>
          </div>
          <ul
            id={`${id}-list`}
            role="listbox"
            aria-multiselectable="true"
            ref={listRef}
            /* A click on an option must not activate a wrapping <label>, which would focus the input and reopen the list. */
            onClick={(event) => event.preventDefault()}
            className="max-h-64 overflow-auto py-1"
          >
            {shown.length === 0 ? (
              <li className="px-3 py-2 text-muted-foreground">{options.length === 0 ? 'Nothing to choose from' : 'No matches'}</li>
            ) : (
              shown.map((option, index) => {
                const selected = value.includes(option);
                return (
                  <li
                    key={option}
                    id={`${id}-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-checked={selected}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      toggle(option);
                    }}
                    onMouseEnter={() => setActive(index)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${index === activeIndex ? 'bg-accent text-accent-foreground' : ''}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>
                      {selected && <Check size={12} aria-hidden />}
                    </span>
                    {option}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
