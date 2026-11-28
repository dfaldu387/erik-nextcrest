import { useQuery } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { checkDatabase } from '@/lib/databaseStatus';
import type { DatabaseStatus } from '@/lib/databaseStatus';

type BadgeState = DatabaseStatus['state'] | 'checking';

const badge: Record<BadgeState, { label: string; tone: string; hint: string }> = {
  checking: {
    label: 'Checking database',
    tone: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
    hint: 'Checking the connection to the database.',
  },
  connected: {
    label: 'Database connected',
    tone: 'border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200',
    hint: 'The database answers. Screens show data once they are wired to it.',
  },
  'tables-missing': {
    label: 'Connected, tables missing',
    tone: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
    hint: 'The database answers, but the NextCrest tables were not found. Run the migrations.',
  },
  unreachable: {
    label: 'Database unreachable',
    tone: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
    hint: 'The database did not respond.',
  },
  'not-configured': {
    label: 'Database not configured',
    tone: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
    hint: 'The project URL or publishable key is missing from the environment file.',
  },
};

export function DataFreshness() {
  const { data, isPending } = useQuery({
    queryKey: ['database-status'],
    queryFn: checkDatabase,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });

  const state: BadgeState = isPending || !data ? 'checking' : data.state;
  const detail = state === 'unreachable' && data?.state === 'unreachable' ? ` (${data.reason})` : '';
  const view = badge[state];

  return (
    <div
      role="status"
      className={`hidden items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium sm:flex ${view.tone}`}
      title={`${view.hint}${detail}`}
    >
      <Database size={12} aria-hidden="true" />
      <span>
        {view.label}
        {detail}
      </span>
    </div>
  );
}
