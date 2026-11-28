import { RoleMatrix } from '@/components/team/RoleMatrix';
import { TeamAccess } from '@/components/team/TeamAccess';
import { PageHeader } from '@/components/ui/PageHeader';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/States';
import { useActivityQuery } from '@/hooks/useNextCrestData';
import { formatTime } from '@/lib/format';

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

      <TeamAccess />

      <RoleMatrix />

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
