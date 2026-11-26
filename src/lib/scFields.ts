import { supabase } from '@/lib/supabase';
import type { ActionResult } from '@/lib/scActions';

// The contact's custom fields in SmarterContact (name, email, property and mailing address, APN and so on).
// Reading is free of side effects; saving changes the live contact in SmarterContact, so the form saves only on request.
export interface ContactField {
  name: string;
  value: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<({ ok: true } & T) | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'NextCrest is not connected to its database.' };
  try {
    const { data, error } = await supabase.functions.invoke('smartercontact-sync', { body });
    if (!error) return { ok: true, ...(data as T) };
    const details = (await (error as unknown as { context?: Response }).context?.json?.().catch(() => null)) as { error?: string } | null;
    return { ok: false, message: details?.error ?? error.message };
  } catch {
    return { ok: false, message: 'The request could not be sent. Try again.' };
  }
}

export async function getContactFields(contactId: string): Promise<{ ok: true; fields: ContactField[] } | { ok: false; message: string }> {
  const result = await invoke<{ fields: ContactField[] }>({ action: 'get-fields', contactId });
  if (!result.ok) return result;
  return { ok: true, fields: result.fields };
}

export function setContactFields(contactId: string, fields: Record<string, string>): Promise<ActionResult> {
  return invoke<Record<string, never>>({ action: 'set-fields', contactId, fields }) as Promise<ActionResult>;
}
