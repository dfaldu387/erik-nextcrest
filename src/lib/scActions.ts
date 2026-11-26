import { supabase } from '@/lib/supabase';

// Inbox actions that change SmarterContact: sending a reply and marking a conversation read or unread.
// The Edge Function checks the signed-in user and makes the call with the SmarterContact REST API.
export type ActionResult = { ok: true } | { ok: false; message: string; retryAfterSeconds?: number };

async function invoke(body: Record<string, unknown>): Promise<ActionResult> {
  if (!supabase) return { ok: false, message: 'NextCrest is not connected to its database.' };
  try {
    const { error } = await supabase.functions.invoke('smartercontact-sync', { body });
    if (!error) return { ok: true };
    // The function answers errors as JSON: its message, and a wait time for rate limits.
    const details = (await (error as unknown as { context?: Response }).context?.json?.().catch(() => null)) as
      | { error?: string; retry_after_seconds?: number }
      | null;
    return { ok: false, message: details?.error ?? error.message, retryAfterSeconds: details?.retry_after_seconds };
  } catch {
    return { ok: false, message: 'The action could not be sent. Try again.' };
  }
}

/** Sends one text to the contact of the conversation. The contact must have written in the last 7 days. */
export function sendReply(contactId: string, content: string): Promise<ActionResult> {
  return invoke({ action: 'reply', contactId, content });
}

/** Marks one conversation read or unread in SmarterContact. */
export function setConversationRead(contactId: string, read: boolean): Promise<ActionResult> {
  return invoke({ action: 'mark', contactIds: [contactId], read });
}
