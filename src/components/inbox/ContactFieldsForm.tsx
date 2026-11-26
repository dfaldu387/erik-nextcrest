import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CONTACT_FIELDS, currentValues, splitChanges } from '@/lib/contactFields';
import { getContactFields, setContactFields } from '@/lib/scFields';
import { getConversationFields, saveConversationFields } from '@/services/nextcrestData';
import { usePropertyFactsQuery } from '@/hooks/useNextCrestData';

interface Props {
  contactId: string;
  phone: string;
  labels: string[];
  propertyId: string | null;
}

// The conversation's contact form. SmarterContact fields save to SmarterContact on Save. The other fields are kept in
// NextCrest, because SmarterContact's API does not expose them. Nothing is sent until Save is pressed.
export function ContactFieldsForm({ contactId, phone, labels, propertyId }: Props) {
  const queryClient = useQueryClient();
  const scFields = useQuery({
    queryKey: ['sc-fields', contactId],
    queryFn: async () => {
      const result = await getContactFields(contactId);
      if (!result.ok) throw new Error(result.message);
      return Object.fromEntries(result.fields.map((f) => [f.name, f.value]));
    },
    staleTime: 60_000,
  });
  const saved = useQuery({ queryKey: ['conversation-fields', contactId], queryFn: () => getConversationFields(contactId) });
  const property = usePropertyFactsQuery(propertyId);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const loaded = scFields.data !== undefined && saved.data !== undefined;
  const values = loaded ? currentValues(scFields.data ?? {}, saved.data ?? {}, property.data ?? null) : {};
  const readonlyValue = (key: string): string => {
    if (key === 'phone') return phone ? formatPhone(phone) : '—';
    if (key === 'labels') return labels.length ? labels.join(', ') : '—';
    return '—';
  };

  const startEdit = () => {
    setDraft({ ...values });
    setEditing(true);
    setMessage(null);
  };

  const save = async () => {
    const changed = Object.fromEntries(Object.entries(draft).filter(([key, value]) => (values[key] ?? '') !== value));
    if (Object.keys(changed).length === 0) {
      setEditing(false);
      return;
    }
    const { smartercontact, nextcrest } = splitChanges(changed);
    setBusy(true);
    setMessage(null);
    try {
      if (Object.keys(smartercontact).length > 0) {
        const result = await setContactFields(contactId, smartercontact);
        if (!result.ok) throw new Error(result.message);
      }
      if (Object.keys(nextcrest).length > 0) await saveConversationFields(contactId, nextcrest);
      setEditing(false);
      setMessage({ kind: 'ok', text: 'Saved.' });
      await queryClient.invalidateQueries({ queryKey: ['sc-fields', contactId] });
      await queryClient.invalidateQueries({ queryKey: ['conversation-fields', contactId] });
    } catch (saveError) {
      setMessage({ kind: 'error', text: saveError instanceof Error ? saveError.message : 'The fields could not be saved.' });
    } finally {
      setBusy(false);
    }
  };

  const markDealClosed = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await saveConversationFields(contactId, { dealClosed: 'yes' });
      setMessage({ kind: 'ok', text: 'Marked as a closed deal in NextCrest.' });
      await queryClient.invalidateQueries({ queryKey: ['conversation-fields', contactId] });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The deal could not be marked.' });
    } finally {
      setBusy(false);
    }
  };

  const dealClosed = saved.data?.dealClosed === 'yes';

  return (
    <section className="space-y-4 px-4 py-4 text-sm" aria-label="Contact details">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact details</h3>
        {!editing && loaded && (
          <button type="button" className="btn-secondary" onClick={startEdit}>
            Edit
          </button>
        )}
        {editing && (
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {(scFields.isPending || saved.isPending) && <p className="text-muted-foreground">Loading contact details…</p>}
      {scFields.isError && <p role="alert" className="text-red-600 dark:text-red-400">{scFields.error instanceof Error ? scFields.error.message : 'SmarterContact fields could not be loaded.'}</p>}
      {saved.isError && <p role="alert" className="text-red-600 dark:text-red-400">The NextCrest fields could not be loaded.</p>}

      {loaded && (
        <dl className="grid gap-3 sm:grid-cols-2">
          {CONTACT_FIELDS.map((field) => (
            <div key={field.key}>
              <dt className="text-xs text-muted-foreground">
                {field.label}
                {field.source === 'nextcrest' && <span className="ml-1 text-[10px] opacity-70">· NextCrest</span>}
              </dt>
              <dd className="break-words">
                {field.source === 'readonly' ? (
                  readonlyValue(field.key)
                ) : editing ? (
                  <FieldInput field={field} value={draft[field.key] ?? ''} onChange={(value) => setDraft({ ...draft, [field.key]: value })} />
                ) : (
                  values[field.key] || '—'
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          Fields marked NextCrest are kept in NextCrest only. SmarterContact's API does not expose them.
        </p>
        <button type="button" className="btn-secondary" disabled={busy || dealClosed} onClick={markDealClosed}>
          {dealClosed ? 'Deal closed' : 'Mark deal closed'}
        </button>
      </div>

      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}>
          {message.text}
        </p>
      )}
    </section>
  );
}

function FieldInput({ field, value, onChange }: { field: (typeof CONTACT_FIELDS)[number]; value: string; onChange: (value: string) => void }) {
  if (field.type === 'select') {
    return (
      <select className="field w-full" aria-label={field.label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {field.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className="field w-full"
      type={field.type === 'date' ? 'date' : 'text'}
      aria-label={field.label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : phone;
}
