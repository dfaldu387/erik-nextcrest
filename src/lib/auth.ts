import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { clearRecordsCache } from '@/services/nextcrestData';
import { queryClient, USER_SCOPED_QUERY_KEYS } from '@/lib/queryClient';

export type AuthState =
  | { status: 'unconfigured' }
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; session: Session };

// Re-reads the session whenever it changes, and drops cached data so a new user never sees the last user's rows.
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(() => (supabase ? { status: 'loading' } : { status: 'unconfigured' }));

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    let lastUserId: string | null | undefined;

    const apply = (session: Session | null) => {
      if (!active) return;
      setState(session ? { status: 'signed-in', session } : { status: 'signed-out' });
    };

    client.auth.getSession().then(({ data }) => apply(data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      clearRecordsCache();
      // Only when the user changes. Token refreshes fire this too and must not blank the screens.
      const userId = session?.user.id ?? null;
      if (userId !== lastUserId) {
        lastUserId = userId;
        for (const key of USER_SCOPED_QUERY_KEYS) queryClient.removeQueries({ queryKey: [key] });
      }
      apply(session);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return state;
}

export async function signInWithPassword(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Sign-in is not configured.';
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  return error ? friendlyError(error.message) : null;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

// Shows the reason without exposing internals. The database gives "Invalid login credentials" for both
// an unknown email and a wrong password, and the message does not reveal which.
function friendlyError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'That email and password do not match an account.';
  if (/email not confirmed/i.test(message)) return 'This account has not been confirmed yet. Check the invitation email.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a few minutes and try again.';
  return 'Sign-in failed. Try again.';
}
