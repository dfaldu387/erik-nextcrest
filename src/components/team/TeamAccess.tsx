import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/States';
import { usePropertyFilterOptionsQuery } from '@/hooks/useNextCrestData';
import { useAccountScope } from '@/lib/accountScope';
import { getMyRole, listCountyAssignments, listTeamMembers, setCountyAssignment, setUserAccount, setUserRole } from '@/services/teamAccess';

const MAX_COUNTY_ROWS = 300;
const ROLE_OPTIONS = [
  { value: 'admin', label: 'Owner / Admin' },
  { value: 'data_manager', label: 'Data Manager' },
  { value: 'marketing_user', label: 'Marketing User' },
  { value: 'read_only', label: 'Read-only' },
];

/** Team members, the SmarterContact accounts each one works in, and the counties assigned to each account. */
export function TeamAccess() {
  const queryClient = useQueryClient();
  const role = useQuery({ queryKey: ['my-role'], queryFn: getMyRole });
  const isAdmin = role.data === 'admin';
  const { accounts } = useAccountScope();
  const members = useQuery({ queryKey: ['team-members'], queryFn: listTeamMembers });
  const counties = useQuery({ queryKey: ['county-assignments'], queryFn: listCountyAssignments });
  const places = usePropertyFilterOptionsQuery();
  const [chosen, setChosen] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selectedAccount = chosen || accounts[0]?.id || '';

  const toggleUser = useMutation({
    mutationFn: (v: { userId: string; accountId: string; on: boolean }) => setUserAccount(v.userId, v.accountId, v.on),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['team-members'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: string }) => setUserRole(v.userId, v.role),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['team-members'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggleCounty = useMutation({
    mutationFn: (v: { accountId: string; state: string; county: string; on: boolean }) =>
      setCountyAssignment(v.accountId, v.state, v.county, v.on),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['county-assignments'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const assigned = useMemo(() => {
    const set = new Set<string>();
    for (const row of counties.data ?? []) {
      if (row.accountId === selectedAccount) set.add(`${row.state}|${row.county}`);
    }
    return set;
  }, [counties.data, selectedAccount]);

  const countyOptions = useMemo(() => {
    const all = places.data?.places ?? [];
    const term = search.trim().toLowerCase();
    const matches = all.filter((p) => !term || `${p.county} ${p.state}`.toLowerCase().includes(term));
    return { total: matches.length, rows: matches.slice(0, MAX_COUNTY_ROWS) };
  }, [places.data, search]);

  if (members.isPending || counties.isPending || role.isPending) return <CardSkeleton rows={4} />;
  if (members.isError || counties.isError) {
    return <ErrorState message="The team could not be loaded." onRetry={() => { void members.refetch(); void counties.refetch(); }} />;
  }

  const accountLabel = accounts.find((a) => a.id === selectedAccount)?.label ?? 'the account';

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-[12px] border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}
      {!isAdmin && (
        <p className="text-xs text-muted-foreground">Only an admin can change accounts or counties. You can see them here.</p>
      )}

      <section className="card overflow-x-auto" aria-labelledby="members-heading">
        <div className="border-b border-border p-4">
          <h2 id="members-heading" className="text-base font-semibold">Team members and accounts</h2>
          <p className="text-xs text-muted-foreground">Tick each SmarterContact account a person works in.</p>
        </div>
        {(members.data ?? []).length === 0 ? (
          <EmptyState title="No team members yet" description="Users appear here once they have signed in to NextCrest." />
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Team members and their SmarterContact accounts</caption>
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">Name</th>
                <th scope="col" className="px-4 py-3 font-medium">Email</th>
                <th scope="col" className="px-4 py-3 font-medium">Role</th>
                {accounts.map((a) => (
                  <th key={a.id} scope="col" className="px-4 py-3 font-medium">{a.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(members.data ?? []).map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-medium">{m.fullName ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{m.email}</td>
                  <td className="px-4 py-2.5">
                    {isAdmin ? (
                      <select
                        aria-label={`Role for ${m.fullName ?? m.email}`}
                        value={m.role}
                        disabled={changeRole.isPending}
                        onChange={(e) => changeRole.mutate({ userId: m.id, role: e.target.value })}
                        className="field"
                      >
                        {ROLE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                        {!ROLE_OPTIONS.some((o) => o.value === m.role) && <option value={m.role}>{m.role}</option>}
                      </select>
                    ) : (
                      m.role
                    )}
                  </td>
                  {accounts.map((a) => (
                    <td key={a.id} className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`${m.fullName ?? m.email} works in ${a.label}`}
                        checked={m.accountIds.includes(a.id)}
                        disabled={!isAdmin || toggleUser.isPending}
                        onChange={(e) => toggleUser.mutate({ userId: m.id, accountId: a.id, on: e.target.checked })}
                        className="h-4 w-4 accent-[var(--brand,#7c3aed)]"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card space-y-4 p-5" aria-labelledby="counties-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="counties-heading" className="text-base font-semibold">Counties by account</h2>
            <p className="text-xs text-muted-foreground">
              {assigned.size.toLocaleString('en-US')} counties assigned to {accountLabel}.
            </p>
          </div>
          <label className="text-xs text-muted-foreground">
            <span className="mb-1 block">Account</span>
            <select value={selectedAccount} onChange={(e) => setChosen(e.target.value)} className="field">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </label>
        </div>

        {accounts.length === 0 ? (
          <EmptyState title="No accounts" description="Connect a SmarterContact account first." />
        ) : (
          <>
            <label className="block">
              <span className="sr-only">Search counties</span>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search county or state" className="field w-full sm:max-w-sm" />
            </label>
            {places.isPending ? (
              <CardSkeleton rows={3} />
            ) : (
              <>
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {countyOptions.rows.map((p) => {
                    const key = `${p.state}|${p.county}`;
                    return (
                      <li key={key}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={assigned.has(key)}
                            disabled={!isAdmin || toggleCounty.isPending || !selectedAccount}
                            onChange={(e) => toggleCounty.mutate({ accountId: selectedAccount, state: p.state, county: p.county, on: e.target.checked })}
                            className="h-4 w-4"
                          />
                          <span>{p.county}, {p.state}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {countyOptions.total > MAX_COUNTY_ROWS && (
                  <p className="text-xs text-muted-foreground">Showing {MAX_COUNTY_ROWS} of {countyOptions.total.toLocaleString('en-US')}. Search to find more.</p>
                )}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
