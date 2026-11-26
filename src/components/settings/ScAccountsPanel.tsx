import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { addScAccount, listScAccounts, setScAccountEnabled } from '@/lib/scAccounts';
import type { ScAccount } from '@/lib/scAccounts';

// Connected SmarterContact accounts. Each one is read by the sync with its own sign-in. Admins only: for anyone else
// the list request is refused and the panel does not show.
export function ScAccountsPanel() {
  const [accounts, setAccounts] = useState<ScAccount[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [label, setLabel] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = async () => {
    const result = await listScAccounts();
    if (!result.ok) {
      if (result.status === 403) setHidden(true);
      else setMessage({ kind: 'error', text: result.message });
      return;
    }
    setAccounts(result.data.accounts);
  };

  useEffect(() => {
    void load();
  }, []);

  if (hidden) return null;

  const onAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await addScAccount(label, clientId, clientSecret);
    setBusy(false);
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.message });
      return;
    }
    setLabel('');
    setClientId('');
    setClientSecret('');
    setMessage({ kind: 'ok', text: 'Account connected. Its conversations appear in the Inbox within a few minutes.' });
    await load();
  };

  const onToggle = async (account: ScAccount) => {
    setBusy(true);
    setMessage(null);
    const result = await setScAccountEnabled(account.id, !account.enabled);
    setBusy(false);
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.message });
      return;
    }
    await load();
  };

  return (
    <section className="card space-y-5 p-5" aria-labelledby="sc-accounts-heading">
      <div>
        <h2 id="sc-accounts-heading" className="text-base font-semibold">SmarterContact accounts</h2>
        <p className="text-xs text-muted-foreground">
          Each account is read with its own sign-in. Enter the client ID and client secret for the account. They are checked with SmarterContact before they are saved.
        </p>
      </div>

      {accounts === null ? (
        <p className="text-sm text-muted-foreground">Loading accounts…</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No accounts are connected yet.</p>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Account</th>
                <th className="py-2 pr-3 font-medium">Profile</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-t border-border">
                  <td className="py-2 pr-3">{account.label}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">{account.profileId ? `${account.profileId.slice(0, 8)}…` : '—'}</td>
                  <td className="py-2 pr-3">{account.enabled ? 'On' : 'Off'}</td>
                  <td className="py-2 text-right">
                    <button type="button" className="btn-secondary" disabled={busy} onClick={() => onToggle(account)}>
                      {account.enabled ? 'Switch off' : 'Switch on'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={onAdd} className="grid gap-3 md:grid-cols-3" noValidate>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">Account name</span>
          <input className="field w-full" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ann" maxLength={60} required />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">Client ID</span>
          <input className="field w-full" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" required />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">Client secret</span>
          <input className="field w-full" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" required />
        </label>
        <div className="flex items-center gap-3 md:col-span-3">
          <button type="submit" className="btn-primary" disabled={busy || !label.trim() || !clientId.trim() || !clientSecret.trim()}>
            {busy ? 'Checking…' : 'Connect account'}
          </button>
          {message && (
            <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
              {message.text}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
