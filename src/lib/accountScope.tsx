import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { listScAccounts, type ScAccount } from '@/lib/scAccounts';

// The SmarterContact account the screens show. null means all accounts.
// Remembered in this browser, so the choice survives a reload.
const STORAGE_KEY = 'nc-account-scope';

interface AccountScope {
  accountId: string | null;
  setAccountId: (id: string | null) => void;
  accounts: ScAccount[];
}

const AccountScopeContext = createContext<AccountScope>({ accountId: null, setAccountId: () => undefined, accounts: [] });

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function AccountScopeProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountIdState] = useState<string | null>(() => readStored());

  // Only an admin can list the accounts. For anyone else the list is empty and the switch is hidden.
  const accountsQuery = useQuery({
    queryKey: ['sc-accounts'],
    queryFn: async () => {
      const result = await listScAccounts();
      return result.ok ? result.data.accounts.filter((a) => a.enabled) : [];
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const accounts = useMemo<ScAccount[]>(() => accountsQuery.data ?? [], [accountsQuery.data]);

  const value = useMemo<AccountScope>(() => {
    const setAccountId = (id: string | null) => {
      setAccountIdState(id);
      try {
        if (id) window.localStorage.setItem(STORAGE_KEY, id);
        else window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Storage can be blocked; the choice still applies for this visit.
      }
    };
    // A stored account that no longer exists falls back to all accounts.
    const known = accountId === null || accounts.some((a) => a.id === accountId);
    return { accountId: known ? accountId : null, setAccountId, accounts };
  }, [accountId, accounts]);

  return <AccountScopeContext.Provider value={value}>{children}</AccountScopeContext.Provider>;
}

export function useAccountScope(): AccountScope {
  return useContext(AccountScopeContext);
}
