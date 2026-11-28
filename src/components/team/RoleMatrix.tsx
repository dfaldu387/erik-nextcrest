import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CardSkeleton, ErrorState } from '@/components/ui/States';
import { usePermissions } from '@/lib/permissions';
import { ACCESS_LEVELS, listRolePermissions, setRolePermission, type AccessLevel } from '@/services/teamAccess';

const ROLE_COLUMNS = [
  { key: 'admin', label: 'Owner / Admin' },
  { key: 'data_manager', label: 'Data Manager' },
  { key: 'marketing_user', label: 'Marketing User' },
  { key: 'read_only', label: 'Read-only' },
] as const;

const AREAS = [
  'Dashboard',
  'Properties',
  'Data Purchases and Import',
  'Duplicate Checker',
  'Lists and exports',
  'Campaigns',
  'Follow-ups and responders',
  'Opt-outs and wrong numbers',
  'Integrations',
  'Reports',
  'Team and settings',
];

/** What each role may open. Admins can change every role except their own column, which stays Full. */
export function RoleMatrix() {
  const queryClient = useQueryClient();
  const { isAdmin } = usePermissions();
  const perms = useQuery({ queryKey: ['role-permissions'], queryFn: listRolePermissions });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (v: { role: string; area: string; access: AccessLevel }) => setRolePermission(v.role, v.area, v.access),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['role-permissions'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (perms.isPending) return <CardSkeleton rows={4} />;
  if (perms.isError) return <ErrorState message="The role permissions could not be loaded." onRetry={() => perms.refetch()} />;

  const lookup = new Map<string, AccessLevel>();
  for (const p of perms.data) lookup.set(`${p.role}|${p.area}`, p.access);

  return (
    <section className="card overflow-x-auto" aria-labelledby="roles-heading">
      <div className="border-b border-border p-4">
        <h2 id="roles-heading" className="text-base font-semibold">Role permissions</h2>
        <p className="text-xs text-muted-foreground">
          {isAdmin ? 'Change what each role can open. Pages set to None are hidden from that role.' : 'Only an admin can change these.'}
        </p>
      </div>
      {error && (
        <div role="alert" className="m-4 rounded-[12px] border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}
      <table className="w-full min-w-[720px] text-left text-sm">
        <caption className="sr-only">Access by role</caption>
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">Area</th>
            {ROLE_COLUMNS.map((r) => (
              <th key={r.key} scope="col" className="px-4 py-3 font-medium">{r.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {AREAS.map((area) => (
            <tr key={area} className="border-b border-border last:border-0">
              <th scope="row" className="px-4 py-2.5 text-left font-medium">{area}</th>
              {ROLE_COLUMNS.map((r) => {
                const current = (r.key === 'admin' ? 'Full' : lookup.get(`${r.key}|${area}`)) ?? 'None';
                const locked = !isAdmin || r.key === 'admin';
                return (
                  <td key={r.key} className="px-4 py-2.5">
                    {locked ? (
                      <span className={current === 'None' ? 'text-muted-foreground' : ''}>{current}</span>
                    ) : (
                      <select
                        aria-label={`${r.label} access to ${area}`}
                        value={current}
                        disabled={save.isPending}
                        onChange={(e) => save.mutate({ role: r.key, area, access: e.target.value as AccessLevel })}
                        className="field"
                      >
                        {ACCESS_LEVELS.map((level) => (
                          <option key={level} value={level}>{level}</option>
                        ))}
                      </select>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
