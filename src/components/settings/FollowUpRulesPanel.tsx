import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { loadFollowUpRules, saveFollowUpRules } from '@/services/nextcrestData';
import { DEFAULT_FOLLOW_UP_RULES } from '@/lib/followUp';
import type { FollowUpRules } from '@/lib/followUp';

// The follow-up rules: how long after a contact a follow-up is due, how many contacts a property gets in a cycle, and
// when a property is re-hit. Saved rules apply to the Properties screen, the dashboard and the Follow-Up Queue.
export function FollowUpRulesPanel() {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FollowUpRules>(DEFAULT_FOLLOW_UP_RULES);
  const [saved, setSaved] = useState<FollowUpRules>(DEFAULT_FOLLOW_UP_RULES);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadFollowUpRules().then((rules) => {
      setValues(rules);
      setSaved(rules);
    });
  }, []);

  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const problem =
    !Number.isInteger(values.quietDays) || values.quietDays < 0 || values.quietDays > 365
      ? 'Days after a contact must be a whole number from 0 to 365.'
      : !Number.isInteger(values.maxContacts) || values.maxContacts < 1 || values.maxContacts > 20
        ? 'Contacts per cycle must be a whole number from 1 to 20.'
        : !Number.isInteger(values.rehitDays) || values.rehitDays < 1 || values.rehitDays > 730
          ? 'Re-hit period must be a whole number from 1 to 730 days.'
          : null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (problem) {
      setMessage({ kind: 'error', text: problem });
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await saveFollowUpRules(values);
    setBusy(false);
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.message });
      return;
    }
    setSaved(values);
    setMessage({ kind: 'ok', text: 'Follow-up rules saved. The lists and dashboard now use them.' });
    for (const key of ['records', 'properties', 'dashboard-summary', 'lead-groups', 'inbox-counts']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const field = (label: string, value: number, onChange: (next: number) => void, hint: string) => (
    <label className="space-y-1 text-sm">
      <span className="block font-medium">{label}</span>
      <input
        className="field w-full"
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="block text-xs text-muted-foreground">{hint}</span>
    </label>
  );

  return (
    <section className="card space-y-5 p-5" aria-labelledby="follow-up-rules-heading">
      <div>
        <h2 id="follow-up-rules-heading" className="text-base font-semibold">Follow-up rules</h2>
        <p className="text-xs text-muted-foreground">Only an admin can change these. The defaults are 7 days, 3 contacts and 90 days.</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {field('Days before a follow-up', values.quietDays, (quietDays) => setValues({ ...values, quietDays }), 'After a contact, wait this long before a follow-up is due.')}
          {field('Contacts per cycle', values.maxContacts, (maxContacts) => setValues({ ...values, maxContacts }), 'At this many contacts, a property waits for its re-hit.')}
          {field('Re-hit after (days)', values.rehitDays, (rehitDays) => setValues({ ...values, rehitDays }), 'Days after the last contact before the property is re-hit.')}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save rules'}
          </button>
          {problem && <p className="text-sm text-red-600 dark:text-red-400">{problem}</p>}
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
