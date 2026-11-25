import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: (string | SelectOption)[];
  // Label of the empty choice (e.g. "All states"). It is always listed first and is what an empty value means.
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

function toOption(option: string | SelectOption): SelectOption {
  return typeof option === 'string' ? { value: option, label: option } : option;
}

// A dropdown with a search box on top. Type to narrow the list; arrow keys, Enter and Escape work as in a listbox.
export function SearchableSelect({ value, onChange, options, placeholder, ariaLabel, disabled, className = '' }: SearchableSelectProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const all = useMemo<SelectOption[]>(
    () => [{ value: '', label: placeholder }, ...options.map(toOption)],
    [options, placeholder],
  );
  const selectedLabel = all.find((o) => o.value === value)?.label ?? placeholder;

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => (needle === '' ? all : all.filter((o) => o.value === '' || o.label.toLowerCase().includes(needle))),
    [all, needle],
  );
  const activeIndex = Math.min(active, Math.max(shown.length - 1, 0));

  const openList = () => {
    if (disabled) return;
    setQuery('');
    setActive(Math.max(0, all.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const choose = (next: string) => {
    onChange(next);
    close();
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

  // Keep the highlighted option visible while moving with the arrow keys.
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
      choose(shown[activeIndex].value);
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
        value={open ? query : selectedLabel}
        placeholder={selectedLabel}
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
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          ref={listRef}
          /* A click on an option must not activate a wrapping <label>, which would focus the input and reopen the list. */
          onClick={(event) => event.preventDefault()}
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-[10px] border border-border bg-card py-1 text-sm shadow-lg"
        >
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">No matches</li>
          ) : (
            shown.map((option, index) => (
              <li
                key={option.value || '__all'}
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option.value);
                }}
                onMouseEnter={() => setActive(index)}
                className={`cursor-pointer px-3 py-2 ${index === activeIndex ? 'bg-accent text-accent-foreground' : ''} ${
                  option.value === value ? 'font-medium' : ''
                }`}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
