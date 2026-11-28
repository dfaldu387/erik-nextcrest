import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getMyRole, listRolePermissions, type AccessLevel } from '@/services/teamAccess';

// Which permission area each page belongs to (the areas in the role matrix). Paths not listed are open to everyone signed in.
const AREA_BY_PATH: [string, string][] = [
  ['/dashboard', 'Dashboard'],
  ['/properties', 'Properties'],
  ['/purchases', 'Data Purchases and Import'],
  ['/check-before-buying', 'Data Purchases and Import'],
  ['/search-buy', 'Data Purchases and Import'],
  ['/import-export', 'Data Purchases and Import'],
  ['/duplicates', 'Duplicate Checker'],
  ['/lists', 'Lists and exports'],
  ['/campaigns', 'Campaigns'],
  ['/followups', 'Follow-ups and responders'],
  ['/responders', 'Follow-ups and responders'],
  ['/inbox', 'Follow-ups and responders'],
  ['/optouts', 'Opt-outs and wrong numbers'],
  ['/wrong-numbers', 'Opt-outs and wrong numbers'],
  ['/integrations', 'Integrations'],
  ['/reports', 'Reports'],
  ['/team', 'Team and settings'],
  ['/settings', 'Team and settings'],
];

/** The permission area a page belongs to, or null when the page is open to everyone signed in. */
export function areaForPath(pathname: string): string | null {
  const hit = AREA_BY_PATH.find(([path]) => pathname === path || pathname.startsWith(`${path}/`));
  return hit ? hit[1] : null;
}

/**
 * What the signed-in user may open. Admins may open everything. Anyone else may open an area unless its access is None.
 * Enforced in the app's pages; the database rules for rows are a separate change.
 */
export function usePermissions() {
  const role = useQuery({ queryKey: ['my-role'], queryFn: getMyRole, staleTime: 5 * 60_000 });
  const perms = useQuery({ queryKey: ['role-permissions'], queryFn: listRolePermissions, staleTime: 5 * 60_000 });

  const access = useMemo(() => {
    const map = new Map<string, AccessLevel>();
    for (const p of perms.data ?? []) map.set(`${p.role}|${p.area}`, p.access);
    return map;
  }, [perms.data]);

  const current = role.data ?? null;
  const isAdmin = current === 'admin';

  return {
    loading: role.isPending || perms.isPending,
    error: role.isError || perms.isError,
    role: current,
    isAdmin,
    canAccess: (area: string) => isAdmin || (access.get(`${current}|${area}`) ?? 'None') !== 'None',
    accessFor: (area: string): AccessLevel | null => (isAdmin ? 'Full' : (access.get(`${current}|${area}`) ?? null)),
  };
}
