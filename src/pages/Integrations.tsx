import { Plug, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { checkDatabase } from '@/lib/databaseStatus';
import type { DatabaseStatus } from '@/lib/databaseStatus';
import { checkLandPortal } from '@/lib/integrationStatus';
import type { LandPortalStatus } from '@/lib/integrationStatus';
import { formatTime } from '@/lib/format';

type Tone = 'good' | 'warn' | 'bad' | 'neutral';

interface Status {
  label: string;
  tone: Tone;
  detail: string;
}

const toneClass: Record<Tone, string> = {
  good: 'bg-green-100 text-green-800 ring-green-400 dark:bg-green-950 dark:text-green-200 dark:ring-green-700',
  warn: 'bg-amber-50 text-amber-800 ring-amber-400 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-700',
  bad: 'bg-red-50 text-red-800 ring-red-400 dark:bg-red-950 dark:text-red-200 dark:ring-red-700',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600',
};

function landPortalStatus(data: LandPortalStatus | undefined, pending: boolean): Status {
  if (pending || !data) {
    return { label: 'Checking', tone: 'neutral', detail: 'Testing the Land Portal key.' };
  }
  switch (data.state) {
    case 'connected':
      return { label: 'Connected', tone: 'good', detail: 'The Land Portal API accepted the key. Purchases still happen on the Land Portal site.' };
    case 'rejected':
      return { label: 'Credentials rejected', tone: 'bad', detail: `Land Portal refused the key (HTTP ${data.httpStatus}). Generate a new token in the Land Portal profile.` };
    case 'not-configured':
      return { label: 'Awaiting API credentials', tone: 'warn', detail: 'No Land Portal key is set in the environment file.' };
    case 'unreachable':
      return { label: 'Connection error', tone: 'bad', detail: 'The Land Portal API did not respond.' };
    case 'error':
      return { label: 'Connection error', tone: 'bad', detail: `The Land Portal API returned HTTP ${data.httpStatus}.` };
    case 'unavailable':
      return { label: 'Check not available', tone: 'neutral', detail: 'The status check only runs in the development server. A deployed build needs its own server-side check.' };
  }
}

function databaseStatus(data: DatabaseStatus | undefined, pending: boolean): Status {
  if (pending || !data) {
    return { label: 'Checking', tone: 'neutral', detail: 'Testing the database connection.' };
  }
  switch (data.state) {
    case 'connected':
      return { label: 'Connected', tone: 'good', detail: 'The database answers. Screens will show its data once they are wired to it.' };
    case 'tables-missing':
      return { label: 'Connected, tables missing', tone: 'warn', detail: 'The database answers, but the NextCrest tables were not found. Run the migrations.' };
    case 'unreachable':
      return { label: 'Connection error', tone: 'bad', detail: `The database did not respond (${data.reason}).` };
    case 'not-configured':
      return { label: 'Not configured', tone: 'neutral', detail: 'The project URL or publishable key is missing from the environment file.' };
  }
}

export function Integrations() {
  const landPortal = useQuery({
    queryKey: ['integration-landportal'],
    queryFn: checkLandPortal,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const database = useQuery({
    queryKey: ['database-status'],
    queryFn: checkDatabase,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const providers = [
    {
      key: 'landportal',
      name: 'Land Portal',
      purpose: 'Property data acquisition',
      status: landPortalStatus(landPortal.data, landPortal.isPending),
      checkedAt: landPortal.data?.checkedAt,
      canTest: true,
      onTest: () => void landPortal.refetch(),
      testing: landPortal.isFetching,
      fallback: { label: 'Import a purchased file', to: '/import-export' },
    },
    {
      key: 'smartercontact',
      name: 'SmarterContact',
      purpose: 'Texting campaigns and replies',
      status: {
        label: 'Awaiting API verification',
        tone: 'warn' as Tone,
        detail: 'No SmarterContact connector exists yet, and its API, webhooks and rate limits have not been confirmed. Campaign history comes from manual exports.',
      },
      checkedAt: undefined,
      canTest: false,
      onTest: () => undefined,
      testing: false,
      fallback: { label: 'Export a campaign file', to: '/import-export' },
    },
    {
      key: 'supabase',
      name: 'Supabase',
      purpose: 'Database and sign-in',
      status: databaseStatus(database.data, database.isPending),
      checkedAt: database.dataUpdatedAt ? new Date(database.dataUpdatedAt).toISOString() : undefined,
      canTest: true,
      onTest: () => void database.refetch(),
      testing: database.isFetching,
      fallback: undefined,
    },
    {
      key: 'googledrive',
      name: 'Google Drive',
      purpose: 'Optional file backup',
      status: { label: 'Not configured', tone: 'neutral' as Tone, detail: 'No backup connector exists. This is optional.' },
      checkedAt: undefined,
      canTest: false,
      onTest: () => undefined,
      testing: false,
      fallback: undefined,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Integrations' }]}
        title="Integrations"
        description="Which outside services are connected, and what each one needs before it can sync."
      />

      <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        A service shows as connected only after its check passes. Sync is not built for any service yet, so sync buttons stay disabled.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {providers.map((p) => (
          <article key={p.key} className="card flex flex-col gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Plug size={18} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold">{p.name}</h2>
                  <p className="text-xs text-muted-foreground">{p.purpose}</p>
                </div>
              </div>
              <span
                role="status"
                className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${toneClass[p.status.tone]}`}
              >
                {p.status.label}
              </span>
            </div>

            <p className="text-sm text-muted-foreground">{p.status.detail}</p>

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Last check</dt>
                <dd className="font-medium">{p.checkedAt ? formatTime(p.checkedAt) : 'Not checked yet'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last successful sync</dt>
                <dd className="font-medium">Never</dd>
              </div>
            </dl>

            <div className="mt-auto flex flex-wrap gap-2 pt-2">
              {p.canTest ? (
                <button type="button" className="btn-secondary" onClick={p.onTest} disabled={p.testing}>
                  <RefreshCw size={14} aria-hidden="true" className={p.testing ? 'animate-spin' : ''} />
                  {p.testing ? 'Testing' : 'Test connection'}
                </button>
              ) : (
                <button type="button" className="btn-secondary" disabled title="No connector exists for this service yet">
                  Test connection
                </button>
              )}
              <button type="button" className="btn-secondary" disabled title="Sync is not built yet">
                Sync now
              </button>
              {p.fallback && (
                <Link to={p.fallback.to} className="btn-ghost">
                  {p.fallback.label}
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
