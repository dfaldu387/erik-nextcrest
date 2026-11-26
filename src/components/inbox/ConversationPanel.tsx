import { useQueryClient } from '@tanstack/react-query';
import { Check, MoreHorizontal, Send, User, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConversationMessagesQuery, useConversationNotesQuery, usePropertyFactsQuery } from '@/hooks/useNextCrestData';
import { ContactFieldsForm } from '@/components/inbox/ContactFieldsForm';
import { formatDate } from '@/lib/format';
import { refreshConversationFromSmarterContact, type OpenRefreshState } from '@/lib/scRefresh';
import { sendReply, setConversationRead } from '@/lib/scActions';
import { addConversationNote, addPhoneToDoNotCall } from '@/services/nextcrestData';
import type { InboxRecord, ThreadMessage } from '@/services/nextcrestData';

type PanelTab = 'messages' | 'info' | 'notes';

const TABS: { key: PanelTab; label: string }[] = [
  { key: 'messages', label: 'Messages' },
  { key: 'info', label: 'Info' },
  { key: 'notes', label: 'Notes' },
];

// "8434758031" -> "(843) 475-8031"
function formatPhone(digits: string): string {
  if (!/^\d{10}$/.test(digits)) return digits || '—';
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// The "..." menu on the conversation header. Only actions the SmarterContact API supports, or that NextCrest can do itself,
// are enabled. The rest are shown disabled, with the reason, so nothing looks like it works when it doesn't.
function ContactMenu({ phone }: { phone: string }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const addToDnc = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await addPhoneToDoNotCall(phone);
      setMessage({ kind: 'ok', text: 'Added to the Do Not Call list. Exports will leave this number out.' });
    } catch (dncError) {
      setMessage({ kind: 'error', text: dncError instanceof Error ? dncError.message : 'The number could not be added.' });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const disabled = (label: string, reason: string) => (
    <button type="button" disabled title={reason} className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-muted-foreground opacity-60">
      {label}
    </button>
  );

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          setConfirming(false);
        }}
        aria-label="Contact actions"
        aria-expanded={open}
        className="rounded-md p-1.5 hover:bg-accent"
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-64 space-y-0.5 rounded-xl border border-border bg-card p-1.5 shadow-lg">
          {confirming ? (
            <div className="space-y-2 p-2 text-sm">
              <p>Add this number to the Do Not Call list? Exports will leave it out.</p>
              <div className="flex gap-2">
                <button type="button" className="btn-primary" disabled={busy} onClick={addToDnc}>
                  {busy ? 'Adding…' : 'Add'}
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" role="menuitem" className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => setConfirming(true)}>
                Move to DNC list
              </button>
              {disabled('Delete contact', "SmarterContact's API cannot delete a contact.")}
              {disabled('Open in new tab', "The SmarterContact API does not give the web address of a contact.")}
              {disabled('Export to CRM', 'CRM export is not available through the SmarterContact API.')}
              {disabled('Manage outreach', 'Not available through the SmarterContact API.')}
            </>
          )}
          {message && (
            <p role={message.kind === 'error' ? 'alert' : 'status'} className={`px-3 pb-2 text-xs ${message.kind === 'error' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function money(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('en-US')}`;
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// The property's details, shown on the Info tab when the conversation is matched to a property.
function PropertyFactsSection({ propertyId }: { propertyId: string }) {
  const { data, isPending, isError } = usePropertyFactsQuery(propertyId);
  if (isPending) return <p className="px-4 pb-4 text-sm text-muted-foreground">Loading property details…</p>;
  if (isError || !data) return <p className="px-4 pb-4 text-sm text-muted-foreground">Property details could not be loaded.</p>;
  const or = (value: string) => value || '—';
  const rows: [string, string][] = [
    ['Owner', or(data.ownerName)],
    ['Owner type', or(data.ownerType ?? '')],
    ['Property address', [data.propertyAddress, data.propertyCity, data.propertyZip].filter(Boolean).join(', ') || '—'],
    ['Mailing address', [data.mailingAddress, data.mailingCity, data.mailingState, data.mailingZip].filter(Boolean).join(', ') || '—'],
    ['APN', or(data.apn)],
    ['County', data.county ? `${data.county}, ${data.state}` : '—'],
    ['Acres', data.acres ? `${data.acres} ac` : '—'],
    ['Land use', or(data.landUse)],
    ['Zoning', or(data.zoning)],
    ['Latitude', data.latitude === null ? '—' : data.latitude.toFixed(6)],
    ['Longitude', data.longitude === null ? '—' : data.longitude.toFixed(6)],
    ['Assessed value', money(data.assessedValue)],
    ['Market value', money(data.marketValue)],
    ['Year built', data.yearBuilt === null ? '—' : String(data.yearBuilt)],
    ['Marketing status', data.marketingStatus ? data.marketingStatus.replace(/_/g, ' ') : '—'],
    ['Acquired', data.firstAcquiredAt ? formatDate(data.firstAcquiredAt) : '—'],
  ];
  return (
    <section className="space-y-3 border-t border-border px-4 py-4 text-sm" aria-label="Property details">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Property</h3>
      <dl className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// Notes on this conversation, kept in NextCrest (migration 041). Newest first.
function NotesPanel({ contactId }: { contactId: string }) {
  const queryClient = useQueryClient();
  const notes = useConversationNotesQuery(contactId);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await addConversationNote(contactId, body);
      setText('');
      await queryClient.invalidateQueries({ queryKey: ['conversation-notes', contactId] });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The note could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 overflow-y-auto px-4 py-4 text-sm">
      <div className="rounded-xl border border-border p-3">
        <textarea
          className="block min-h-[96px] w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
          rows={4}
          maxLength={4000}
          placeholder="Type a note…"
          aria-label="New note"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">{text.length}/4000</span>
          <button type="button" className="btn-primary" disabled={busy || text.trim().length === 0} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
      {notes.isPending && <p className="text-muted-foreground">Loading notes…</p>}
      {notes.isError && <p role="alert" className="text-red-600 dark:text-red-400">Notes could not be loaded.</p>}
      {notes.data && notes.data.length === 0 && <p className="text-muted-foreground">No notes yet.</p>}
      <ul className="space-y-3">
        {notes.data?.map((note) => (
          <li key={note.id} className="rounded-xl bg-accent/40 p-3">
            <p className="whitespace-pre-wrap break-words">{note.body}</p>
            <p className="pt-1 text-xs text-muted-foreground">{dateTime(note.createdAt)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function initials(name: string, phone: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return letters || phone.slice(-4) || '?';
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Messages grouped by day, with a separator before each new day.
function groupByDay(messages: ThreadMessage[]): { day: string; messages: ThreadMessage[] }[] {
  const groups: { day: string; messages: ThreadMessage[] }[] = [];
  for (const message of messages) {
    const day = dayLabel(message.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.messages.push(message);
    else groups.push({ day, messages: [message] });
  }
  return groups;
}

function Bubble({ message }: { message: ThreadMessage }) {
  const outgoing = message.direction === 'outgoing';
  const campaign = message.source === 'campaign';
  return (
    <div className={`flex flex-col ${outgoing ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          outgoing ? 'rounded-br-md bg-blue-500 text-white' : 'rounded-bl-md bg-accent text-accent-foreground'
        }`}
      >
        {message.content || (message.type === 'vmd' ? 'Voice message' : message.type === 'call' ? (message.status === 'missed' ? 'Missed call' : 'Call') : message.attachmentCount === 0 ? '[No text]' : null)}
      </div>
      {message.attachments.map((attachment) => (
        <div key={attachment.index} className="mt-1 max-w-[85%]">
          {attachment.contentType.startsWith('audio/') ? (
            <audio controls preload="none" src={attachment.url} className="h-9 w-64 max-w-full">
              Your browser cannot play this recording.
            </audio>
          ) : attachment.contentType.startsWith('image/') ? (
            <a href={attachment.url} target="_blank" rel="noreferrer">
              <img src={attachment.url} alt="Attachment" loading="lazy" className="max-h-48 rounded-lg" />
            </a>
          ) : (
            <a href={attachment.url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
              Open attachment
            </a>
          )}
        </div>
      ))}
      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        <span>{timeLabel(message.createdAt)}</span>
        {outgoing && message.status === 'delivered' && <Check size={12} aria-label="Delivered" />}
      </div>
      {outgoing && (campaign || message.fromNumber) && (
        <div className="mt-0.5 max-w-[85%] text-right text-[11px] text-muted-foreground">
          {campaign && <div>Sent from campaign</div>}
          {message.fromNumber && <div>Outbound number: {formatPhone(message.fromNumber.replace(/\D/g, '').slice(-10))}</div>}
        </div>
      )}
    </div>
  );
}

// The conversation side panel: the selected contact's thread, details and notes.
export function ConversationPanel({ row, onClose }: { row: InboxRecord; onClose: () => void }) {
  const [tab, setTab] = useState<PanelTab>('messages');
  const messages = useConversationMessagesQuery(row.contactId);
  const queryClient = useQueryClient();
  const [refreshState, setRefreshState] = useState<OpenRefreshState>('loading');
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [marking, setMarking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isUnread = row.folders.includes('unread');
  const optedOut = row.folders.includes('opted_out');

  const refreshInbox = () => {
    void queryClient.invalidateQueries({ queryKey: ['inbox-messages', row.contactId] });
    void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    void queryClient.invalidateQueries({ queryKey: ['inbox-counts'] });
  };

  // Sending needs a second click: a reply is a real text to the contact.
  const confirmSend = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setActionError(null);
    const result = await sendReply(row.contactId, text);
    setSending(false);
    setConfirming(false);
    if (result.ok) {
      setDraft('');
      refreshInbox();
    } else {
      setActionError(result.retryAfterSeconds ? `${result.message} You can try again in ${result.retryAfterSeconds} seconds.` : result.message);
    }
  };

  const toggleRead = async () => {
    setMarking(true);
    setActionError(null);
    const result = await setConversationRead(row.contactId, isUnread);
    setMarking(false);
    if (result.ok) refreshInbox();
    else setActionError(result.message);
  };
  const name = row.name || row.ownerName || formatPhone(row.phone);
  const groups = groupByDay(messages.data ?? []);

  // Opening a conversation asks the local sync for its latest messages, then reloads the thread and the list row.
  useEffect(() => {
    let active = true;
    setRefreshState('loading');
    refreshConversationFromSmarterContact(row.contactId).then((state) => {
      if (!active) return;
      setRefreshState(state);
      if (state === 'ok') {
        void queryClient.invalidateQueries({ queryKey: ['inbox-messages', row.contactId] });
        void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      }
    });
    return () => {
      active = false;
    };
  }, [row.contactId, queryClient]);

  return (
    <aside
      aria-label={`Conversation with ${name}`}
      className="card flex h-[min(44rem,calc(100vh-9rem))] min-h-[28rem] flex-col overflow-hidden xl:sticky xl:top-4"
    >
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold">
          {row.name ? initials(row.name, row.phone) : <User size={16} aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{name}</div>
          <div className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{formatPhone(row.phone)}</div>
        </div>
        <button
          type="button"
          onClick={toggleRead}
          disabled={marking}
          className="shrink-0 whitespace-nowrap rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {isUnread ? 'Mark read' : 'Mark unread'}
        </button>
        <ContactMenu phone={row.phone} />
        <button type="button" onClick={onClose} aria-label="Close conversation" className="shrink-0 rounded-md p-1.5 hover:bg-accent">
          <X size={16} aria-hidden />
        </button>
      </header>

      <div role="tablist" aria-label="Conversation sections" className="flex gap-4 border-b border-border px-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 py-2.5 text-sm ${
              tab === t.key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'messages' && (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.isPending && <p className="text-center text-sm text-muted-foreground">Loading messages…</p>}
            {messages.isError && <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">Messages could not be loaded.</p>}
            {!messages.isPending && !messages.isError && groups.length === 0 && (
              <p className="text-center text-sm text-muted-foreground">
                {refreshState === 'loading'
                  ? 'Loading messages from SmarterContact…'
                  : refreshState === 'unavailable'
                    ? 'Messages could not be loaded from SmarterContact right now. Try opening the conversation again.'
                    : 'No messages in this conversation.'}
              </p>
            )}
            {groups.map((group) => (
              <div key={group.day} className="space-y-3">
                <div className="text-center text-xs text-muted-foreground">{group.day}</div>
                {group.messages.map((message) => (
                  <Bubble key={message.id} message={message} />
                ))}
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t border-border p-3">
            {actionError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {actionError}
              </p>
            )}
            {confirming && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent px-3 py-2 text-sm">
                <span>Send this text to {row.name || formatPhone(row.phone)} through SmarterContact?</span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => setConfirming(false)} disabled={sending} className="rounded-md border border-border px-3 py-1 text-xs hover:bg-card">
                    Cancel
                  </button>
                  <button type="button" onClick={confirmSend} disabled={sending} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">
                    {sending ? 'Sending…' : 'Send now'}
                  </button>
                </span>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-border px-3 py-2">
              <textarea
                aria-label="Reply"
                disabled={optedOut || sending}
                rows={2}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setConfirming(false);
                }}
                placeholder={optedOut ? 'This contact has opted out' : 'Write a reply'}
                maxLength={1000}
                className="min-h-[2.5rem] flex-1 resize-none bg-transparent text-sm outline-none disabled:cursor-not-allowed"
              />
              <button
                type="button"
                aria-label="Send"
                onClick={() => setConfirming(true)}
                disabled={optedOut || sending || draft.trim().length === 0 || confirming}
                className="rounded-full bg-primary p-2 text-primary-foreground disabled:opacity-50"
              >
                <Send size={14} aria-hidden />
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">Sent through SmarterContact. The contact must have written in the last 7 days.</p>
          </div>
        </>
      )}

      {tab === 'info' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ContactFieldsForm contactId={row.contactId} phone={row.phone} labels={row.labels} propertyId={row.propertyId} />
      {tab === 'info' && (
        <dl className="space-y-4 overflow-y-auto px-4 py-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Name</dt>
            <dd>{row.name || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Phone</dt>
            <dd className="tabular-nums">{formatPhone(row.phone)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd>{row.email || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Folders</dt>
            <dd className="flex flex-wrap gap-1 pt-1">
              {row.folders
                .filter((f) => f !== 'all')
                .map((f) => (
                  <span key={f} className="rounded-full bg-accent px-2 py-0.5 text-xs">
                    {f.replace(/_/g, ' ')}
                  </span>
                ))}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Labels</dt>
            <dd className="flex flex-wrap gap-1 pt-1">
              {row.labels.length === 0 ? '—' : row.labels.map((l) => (
                <span key={l} className="rounded-full bg-accent px-2 py-0.5 text-xs">
                  {l}
                </span>
              ))}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Property</dt>
            <dd>
              {row.propertyId ? (
                <Link to={`/properties/${row.propertyId}`} className="text-primary hover:underline">
                  Open property
                </Link>
              ) : (
                'Not matched'
              )}
            </dd>
          </div>
          {row.lastMessageAt && (
            <div>
              <dt className="text-xs text-muted-foreground">Last message</dt>
              <dd>{formatDate(row.lastMessageAt)}</dd>
            </div>
          )}
        </dl>
      )}
          {row.propertyId && <PropertyFactsSection propertyId={row.propertyId} />}
        </div>
      )}

      {tab === 'notes' && <NotesPanel contactId={row.contactId} />}
    </aside>
  );
}
