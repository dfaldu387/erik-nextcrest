import { useAccountScope } from '@/lib/accountScope';

/** Chooses which SmarterContact account the screens show. Hidden when there is only one account or none can be listed. */
export function AccountSwitch() {
  const { accountId, setAccountId, accounts } = useAccountScope();
  if (accounts.length === 0) return null;

  return (
    <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="hidden sm:inline">Account</span>
      <select
        value={accountId ?? ''}
        onChange={(event) => setAccountId(event.target.value || null)}
        aria-label="Show data for SmarterContact account"
        className="h-9 max-w-[11rem] rounded-[10px] border border-border bg-card px-2.5 text-sm font-medium text-foreground shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">All accounts</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.label}
          </option>
        ))}
      </select>
    </label>
  );
}
