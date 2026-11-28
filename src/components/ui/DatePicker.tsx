import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { localDateKey } from '@/lib/followUpSchedule';

interface DatePickerProps {
  /** YYYY-MM-DD, or empty when no date is chosen. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
}

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatLong(key: string): string {
  return parseKey(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

/** Six weeks of days, Monday first, covering the month shown. */
function calendarDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** A date field in the app's style. Shows the date in words, with quick choices. Past dates are allowed, for overdue follow-ups. */
export function DatePicker({ value, onChange, disabled = false, id, placeholder = 'Pick a date' }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const base = value ? parseKey(value) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const todayKey = localDateKey();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
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

  const choose = (key: string) => {
    onChange(key);
    setOpen(false);
  };

  const shift = (months: number) => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + months, 1));

  const days = calendarDays(viewMonth);
  const monthLabel = viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div ref={rootRef} className="relative w-full sm:w-56">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open && value) setViewMonth(new Date(parseKey(value).getFullYear(), parseKey(value).getMonth(), 1));
          setOpen((o) => !o);
        }}
        className="field flex w-full items-center justify-between gap-2 text-left"
      >
        <span className={value ? 'text-foreground' : 'text-muted-foreground'}>{value ? formatLong(value) : placeholder}</span>
        <CalendarDays size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div role="dialog" aria-label="Choose a date" className="card absolute left-0 z-20 mt-2 w-72 space-y-3 p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <button type="button" className="btn-secondary h-8 w-8 p-0" aria-label="Previous month" onClick={() => shift(-1)}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="text-sm font-semibold">{monthLabel}</span>
            <button type="button" className="btn-secondary h-8 w-8 p-0" aria-label="Next month" onClick={() => shift(1)}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase text-muted-foreground">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const key = localDateKey(day);
              const inMonth = day.getMonth() === viewMonth.getMonth();
              const selected = key === value;
              const isToday = key === todayKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => choose(key)}
                  aria-label={formatLong(key)}
                  aria-pressed={selected}
                  className={[
                    'h-8 rounded-md text-[13px] tabular-nums transition-colors',
                    selected ? 'bg-primary text-primary-foreground font-semibold' : 'hover:bg-muted',
                    !selected && !inMonth ? 'text-muted-foreground/50' : '',
                    !selected && isToday ? 'ring-1 ring-primary' : '',
                  ].join(' ')}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
            <button type="button" className="btn-secondary h-7 px-2 text-xs" onClick={() => choose(todayKey)}>Today</button>
            <button type="button" className="btn-secondary h-7 px-2 text-xs" onClick={() => choose(localDateKey(addDays(new Date(), 1)))}>Tomorrow</button>
            <button type="button" className="btn-secondary h-7 px-2 text-xs" onClick={() => choose(localDateKey(addDays(new Date(), 7)))}>In 1 week</button>
            <button type="button" className="btn-secondary h-7 px-2 text-xs" onClick={() => choose(localDateKey(addDays(new Date(), 14)))}>In 2 weeks</button>
            <button type="button" className="ml-auto h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => choose('')}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
