import { supabase } from '@/lib/supabase';

// SmarterContact accounts the sync reads. Only an admin can use these; the Edge Function checks the role on every call.
export interface ScAccount {
  id: string;
  label: string;
  profileId: string | null;
  enabled: boolean;
  accessExpiresAt: string | null;
}

export type AccountResult<T> = { ok: true; data: T } | { ok: false; status?: number; message: string };

async function invoke<T>(body: Record<string, unknown>): Promise<AccountResult<T>> {
  if (!supabase) return { ok: false, message: 'NextCrest is not connected to its database.' };
  try {
    const { data, error } = await supabase.functions.invoke('smartercontact-sync', { body });
    if (!error) return { ok: true, data: data as T };
    // The function answers errors as JSON: its message and status.
    const response = (error as unknown as { context?: Response }).context;
    const details = (await response?.json?.().catch(() => null)) as { error?: string } | null;
    return { ok: false, status: response?.status, message: details?.error ?? error.message };
  } catch {
    return { ok: false, message: 'The request could not be sent. Try again.' };
  }
}

export function listScAccounts(): Promise<AccountResult<{ accounts: ScAccount[] }>> {
  return invoke<{ accounts: ScAccount[] }>({ action: 'accounts-list' });
}

export function addScAccount(label: string, clientId: string, clientSecret: string): Promise<AccountResult<{ id: string; profileId: string | null }>> {
  return invoke<{ id: string; profileId: string | null }>({ action: 'accounts-add', label, clientId, clientSecret });
}

export function setScAccountEnabled(id: string, enabled: boolean): Promise<AccountResult<{ ok: true }>> {
  return invoke<{ ok: true }>({ action: 'accounts-toggle', id, enabled });
}
