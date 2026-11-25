import { Check, MoreHorizontal, Phone, PhoneOff, Send, Star, User, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useConversationMessagesQuery } from '@/hooks/useNextCrestData';
import { formatDate } from '@/lib/format';
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
        {message.content || (message.attachmentCount > 0 ? `[${message.attachmentCount} attachment(s)]` : '[No text]')}
      </div>
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
  const name = row.name || formatPhone(row.phone);
  const groups = groupByDay(messages.data ?? []);

  return (
    <aside
      aria-label={`Conversation with ${name}`}
      className="card flex h-[min(44rem,calc(100vh-9rem))] min-h-[28rem] flex-col overflow-hidden xl:sticky xl:top-4"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold">
            {row.name ? initials(row.name, row.phone) : <User size={16} aria-hidden />}
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold">{name}</div>
            <div className="text-xs tabular-nums text-muted-foreground">{formatPhone(row.phone)}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
          <button type="button" aria-label="Favorite" disabled title="Not available yet" className="rounded-md p-1.5 opacity-50">
            <Star size={16} aria-hidden />
          </button>
          <button type="button" aria-label="Call" disabled title="Calls are placed in SmarterContact" className="rounded-md p-1.5 opacity-50">
            <Phone size={16} aria-hidden />
          </button>
          <button type="button" aria-label="Hang up" disabled className="rounded-md p-1.5 opacity-50">
            <PhoneOff size={16} aria-hidden />
          </button>
          <button type="button" aria-label="More" disabled className="rounded-md p-1.5 opacity-50">
            <MoreHorizontal size={16} aria-hidden />
          </button>
          <button type="button" onClick={onClose} aria-label="Close conversation" className="rounded-md p-1.5 hover:bg-accent">
            <X size={16} aria-hidden />
          </button>
        </div>
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
                No messages saved yet. Run the message sync: npm run sync:smartercontact -- --inbox-messages=200
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
          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2 rounded-2xl border border-border px-3 py-2">
              <textarea
                aria-label="Reply"
                disabled
                rows={2}
                placeholder="Replies are sent in SmarterContact"
                className="min-h-[2.5rem] flex-1 resize-none bg-transparent text-sm outline-none disabled:cursor-not-allowed"
              />
              <button type="button" disabled aria-label="Send" className="rounded-full bg-primary p-2 text-primary-foreground opacity-50">
                <Send size={14} aria-hidden />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Sending is turned off here. Replies are sent in SmarterContact.</p>
          </div>
        </>
      )}

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

      {tab === 'notes' && (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          Notes are kept in SmarterContact. They are not copied into NextCrest yet.
        </div>
      )}
    </aside>
  );
}
