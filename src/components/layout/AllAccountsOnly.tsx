import type { ReactNode } from 'react';
import { useAccountScope } from '@/lib/accountScope';

/**
 * For pages whose data is not split by SmarterContact account yet (purchases, imports, duplicate checks).
 * With one account chosen in the top bar, the page is replaced by a notice, so no all-account data shows under that account.
 */
export function AllAccountsOnly({ name, children }: { name: string; children: ReactNode }) {
  const { accountId, accounts, setAccountId } = useAccountScope();
  if (!accountId) return <>{children}</>;
  const label = accounts.find((a) => a.id === accountId)?.label ?? 'the selected account';

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
      <div className="card space-y-3 p-6">
        <p className="text-sm">
          {name} is not split by account yet, so it covers all accounts. It is hidden while <strong>{label}</strong> is selected.
        </p>
        <button type="button" className="btn-secondary" onClick={() => setAccountId(null)}>
          Show all accounts
        </button>
      </div>
    </div>
  );
}
