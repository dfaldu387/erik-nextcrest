import { PageHeader } from '@/components/ui/PageHeader';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/States';
import { useActivityQuery } from '@/hooks/useNextCrestData';
import { formatTime } from '@/lib/format';

const ROLES = ['Owner / Admin', 'Data Manager', 'Marketing User', 'Read-only'] as const;

// What each role may do, from the master build prompt. The UI shows this for reference;
// access is enforced by database row-level security once sign-in is connected.
const PERMISSIONS: { area: string; access: [string, string, string, string] }[] = [
  { area: 'Dashboard', access: ['Full', 'Full', 'Full', 'View'] },
  { area: 'Properties', access: ['Full', 'Full', 'Assigned only', 'View'] },
  { area: 'Data Purchases and Import', access: ['Full', 'Full', 'None', 'None'] },
  { area: 'Duplicate Checker', access: ['Full', 'Full', 'None', 'None'] },
  { area: 'Lists and exports', access: ['Full', 'Full', 'Full', 'None'] },
  { area: 'Campaigns', access: ['Full', 'View', 'View', 'View'] },
  { area: 'Follow-ups and responders', access: ['Full', 'None', 'Full', 'View'] },
  { area: 'Opt-outs and wrong numbers', access: ['Full', 'Full', 'Record only', 'View'] },
  { area: 'Integrations', access: ['Full', 'None', 'None', 'None'] },
  { area: 'Reports', access: ['Full', 'Full', 'None', 'View'] },
  { area: 'Team and settings', access: ['Full', 'None', 'None', 'None'] },
];

export function Team() {
  const { data, isPending, isError, refetch } = useActivityQuery();

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Command Center', to: '/dashboard' }, { label: 'Team' }]}
        title="Team"
        description="Who can do what, and what the team has been working on."
        actions={
          <button type="button" className="btn-primary" disabled title="Inviting users needs sign-in to be connected">
            Invite user
          </button>
        }
      />

      <section className="card overflow-x-auto" aria-labelledby="roles-heading">
        <div className="border-b border-border p-4">
          <h2 id="roles-heading" className="text-base font-semibold">
            Roles and access
          </h2>
          <p className="text-xs text-muted-foreground">Reference only. Changing a user's role needs sign-in to be connected.</p>
        </div>
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">Access by role</caption>
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-4 py-3 font-medium">Area</th>
              {ROLES.map((role) => (
                <th key={role} scope="col" className="px-4 py-3 font-medium">
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((row) => (
              <tr key={row.area} className="border-b border-border last:border-0">
                <th scope="row" className="px-4 py-2.5 text-left font-medium">
                  {row.area}
                </th>
                {row.access.map((value, i) => (
                  <td key={ROLES[i]} className={`px-4 py-2.5 ${value === 'None' ? 'text-muted-foreground' : ''}`}>
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-5" aria-labelledby="activity-heading">
        <h2 id="activity-heading" className="mb-4 text-base font-semibold">
          Recent team activity
        </h2>
        {isPending ? (
          <CardSkeleton rows={3} />
        ) : isError ? (
          <ErrorState message="Team activity could not be loaded." onRetry={() => refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="No activity yet" description="Actions the team takes will appear here." />
        ) : (
          <ul className="divide-y divide-border">
            {data.data.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <p>
                  <span className="font-medium">{event.user}</span> <span className="text-muted-foreground">{event.action}</span>
                </p>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={event.at}>
                  {formatTime(event.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          The full audit log is recorded once the database and sign-in are connected.
        </p>
      </section>
    </div>
  );
}
