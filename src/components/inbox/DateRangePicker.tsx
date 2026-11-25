import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { DATE_PRESETS, calendarGrid, presetRange, toIsoDay, type DatePreset } from '@/lib/inboxFilters';

interface DateRangePickerProps {
  from: string; // YYYY-MM-DD or ''
  to: string;
  onChange: (from: string, to: string) => void;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseDay(day: string): Date | null {
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDay(day: string): string {
  const date = parseDay(day);
  return date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

// A range calendar: presets on the left, a month grid on the right. Click a start day, then an end day.
// Presets and the grid both set the range immediately, so the choice is visible before Apply.
export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  // The current date is read once, when the picker opens, so it does not change while the user is picking.
  const [now] = useState(() => new Date());
  const initial = parseDay(from) ?? now;
  const [view, setView] = useState({ year: initial.getFullYear(), month: initial.getMonth() });
  const [waitingForEnd, setWaitingForEnd] = useState(false);
  const today = toIsoDay(now);

  const pick = (day: string) => {
    if (!waitingForEnd || !from) {
      onChange(day, day);
      setWaitingForEnd(true);
      return;
    }
    setWaitingForEnd(false);
    if (day < from) onChange(day, from);
    else onChange(from, day);
  };

  const choosePreset = (preset: DatePreset) => {
    const range = presetRange(preset);
    onChange(range.from, range.to);
    setWaitingForEnd(false);
    const start = parseDay(range.from);
    if (start) setView({ year: start.getFullYear(), month: start.getMonth() });
  };

  const shiftMonth = (delta: number) => {
    setView((prev) => {
      const date = new Date(prev.year, prev.month + delta, 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });
  };

  const monthTitle = new Date(view.year, view.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="grid gap-4 rounded-xl border border-border p-3 text-sm sm:grid-cols-[9rem_1fr]">
      <ul className="space-y-1">
        {DATE_PRESETS.map((preset) => (
          <li key={preset.key}>
            <button type="button" onClick={() => choosePreset(preset.key)} className="w-full rounded-md px-2 py-1.5 text-left text-primary hover:bg-accent">
              {preset.label}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => {
              onChange('', '');
              setWaitingForEnd(false);
            }}
            className="w-full rounded-md px-2 py-1.5 text-left text-primary hover:bg-accent"
          >
            Clear
          </button>
        </li>
      </ul>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)} className="rounded-md p-1 hover:bg-accent">
            <ChevronLeft size={16} aria-hidden />
          </button>
          <span className="font-medium">{monthTitle}</span>
          <button type="button" aria-label="Next month" onClick={() => shiftMonth(1)} className="rounded-md p-1 hover:bg-accent">
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-y-1 text-center text-xs text-muted-foreground">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div role="grid" aria-label={monthTitle} className="grid grid-cols-7 gap-y-1 text-center">
          {calendarGrid(view.year, view.month).map((cell) => {
            const inRange = !!from && !!to && cell.day >= from && cell.day <= to;
            const isEdge = cell.day === from || cell.day === to;
            const isToday = cell.day === today;
            return (
              <button
                key={cell.day}
                type="button"
                aria-label={formatDay(cell.day)}
                aria-pressed={isEdge}
                onClick={() => pick(cell.day)}
                className={[
                  'mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs tabular-nums',
                  cell.inMonth ? '' : 'text-muted-foreground/50',
                  inRange && !isEdge ? 'rounded-none bg-accent w-full' : '',
                  isEdge ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                  isToday && !isEdge ? 'ring-1 ring-primary' : '',
                ].join(' ')}
              >
                {parseDay(cell.day)?.getDate()}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {from || to ? `${formatDay(from) || '…'} – ${formatDay(to) || '…'}` : 'Click a start day, then an end day.'}
        </p>
      </div>
    </div>
  );
}
