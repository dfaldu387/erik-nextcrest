import { supabase } from '@/lib/supabase';

// Team access: who the NextCrest users are, which SmarterContact accounts each one works in (user_sc_accounts,
// migration 051) and which counties each account is assigned (sc_account_counties, migration 053).
// Writes need an admin; the database rules enforce that, not this file.

export interface TeamMember {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  accountIds: string[];
}

export interface CountyAssignment {
  accountId: string;
  state: string;
  county: string;
}

function requireClient() {
  if (!supabase) throw new Error('NextCrest is not connected to its database.');
  return supabase;
}

/** The role of the person signed in, from their profile. Null when it cannot be read. */
export async function getMyRole(): Promise<string | null> {
  if (!supabase) return null;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.from('profiles').select('role').eq('id', auth.user.id).maybeSingle();
  if (error) throw new Error(`Could not read your role: ${error.message}`);
  return (data?.role as string | undefined) ?? null;
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  if (!supabase) return [];
  const [profiles, links] = await Promise.all([
    supabase.from('profiles').select('id,email,full_name,role').order('email'),
    supabase.from('user_sc_accounts').select('user_id,account_id'),
  ]);
  if (profiles.error) throw new Error(`Could not load the team: ${profiles.error.message}`);
  if (links.error) throw new Error(`Could not load account access: ${links.error.message}`);
  const accountsByUser = new Map<string, string[]>();
  for (const link of links.data ?? []) {
    const userId = link.user_id as string;
    accountsByUser.set(userId, [...(accountsByUser.get(userId) ?? []), link.account_id as string]);
  }
  return (profiles.data ?? []).map((p) => ({
    id: p.id as string,
    email: p.email as string,
    fullName: (p.full_name as string | null) ?? null,
    role: (p.role as string) ?? 'user',
    accountIds: accountsByUser.get(p.id as string) ?? [],
  }));
}

export async function setUserAccount(userId: string, accountId: string, on: boolean): Promise<void> {
  const client = requireClient();
  const { error } = on
    ? await client.from('user_sc_accounts').insert({ user_id: userId, account_id: accountId })
    : await client.from('user_sc_accounts').delete().eq('user_id', userId).eq('account_id', accountId);
  if (error) throw new Error(error.message);
}

export async function listCountyAssignments(): Promise<CountyAssignment[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('sc_account_counties').select('account_id,state,county');
  if (error) throw new Error(`Could not load county assignments: ${error.message}`);
  return (data ?? []).map((row) => ({ accountId: row.account_id as string, state: row.state as string, county: row.county as string }));
}

export async function setCountyAssignment(accountId: string, state: string, county: string, on: boolean): Promise<void> {
  const client = requireClient();
  const { error } = on
    ? await client.from('sc_account_counties').insert({ account_id: accountId, state, county })
    : await client.from('sc_account_counties').delete().eq('account_id', accountId).eq('state', state).eq('county', county);
  if (error) throw new Error(error.message);
}

// ---------- roles and permissions (migration 054) ----------

export const ACCESS_LEVELS = ['Full', 'View', 'Assigned only', 'Record only', 'None'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export interface RolePermission {
  role: string;
  area: string;
  access: AccessLevel;
}

export async function listRolePermissions(): Promise<RolePermission[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('role_permissions').select('role,area,access');
  if (error) throw new Error(`Could not load the role permissions: ${error.message}`);
  return (data ?? []).map((row) => ({ role: row.role as string, area: row.area as string, access: row.access as AccessLevel }));
}

export async function setRolePermission(role: string, area: string, access: AccessLevel): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('role_permissions').upsert({ role, area, access }, { onConflict: 'role,area' });
  if (error) throw new Error(error.message);
}

/** Changes a person's role. The database accepts this only from an admin, and only to a known role. */
export async function setUserRole(userId: string, role: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc('set_user_role', { p_user: userId, p_role: role });
  if (error) throw new Error(error.message);
}
