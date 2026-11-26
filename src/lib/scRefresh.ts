import { supabase } from '@/lib/supabase';

// Opening a conversation asks the smartercontact-sync Edge Function to read its messages from SmarterContact.
// The request carries the signed-in user's session, and the function checks it before reading anything.
export type OpenRefreshState = 'loading' | 'ok' | 'unavailable';

/** Reads one conversation from SmarterContact through the cloud sync. Never throws. */
export async function refreshConversationFromSmarterContact(contactId: string): Promise<OpenRefreshState> {
  if (!supabase) return 'unavailable';
  try {
    const { error } = await supabase.functions.invoke('smartercontact-sync', { body: { contactId } });
    return error ? 'unavailable' : 'ok';
  } catch {
    return 'unavailable';
  }
}
