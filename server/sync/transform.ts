// Turns one SmarterContact contact and its message history (from the MCP connector) into the row that
// smartercontact_mcp_sync (migration 020) loads. Pure functions, no network, so the rules are tested offline.

import { OPT_OUT_WORDS, normalizePhone } from '../webhook/classify.ts';

export interface ContactSummary {
  contactId: string;
  name: string;
  phone: string;
}

// One message from read_conversation. Only the fields the sync needs are typed.
export interface ConversationItem {
  direction: 'incoming' | 'outgoing' | string;
  type: string;
  content: string;
  createdAt: string;
  source?: string;
}

export interface SyncRow {
  phone: string; // 10 digits
  name: string;
  last_campaign_at: string; // ISO time of the newest campaign message
  replied: boolean; // the contact answered a campaign message
  opted_out: boolean; // one of those answers was a stop word
}

// Message types that count as a campaign contact attempt. Calls are not texts and are left out.
const CAMPAIGN_TYPES = new Set(['sms', 'mms', 'vmd']);

// True when the whole reply is a stop word, ignoring case and punctuation. Same rule as the webhook receiver.
export function isOptOutReply(text: string): boolean {
  const normalized = text
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return OPT_OUT_WORDS.includes(normalized);
}

// The Messenger folders, with SmarterContact's own names for them (the category values of list_conversations).
export const INBOX_FOLDERS = ['all', 'unread', 'missed_calls', 'unreplied', 'awaiting_reply', 'opted_out', 'deleted'] as const;
export type InboxFolder = (typeof INBOX_FOLDERS)[number];

export interface ListedConversation {
  contactId: string;
  name?: string;
  email?: string;
  phone?: string;
}

export interface InboxRow {
  contact_id: string;
  name: string;
  email: string | null;
  phone: string | null; // 10 digits, or null when the number is not usable
  folders: InboxFolder[];
}

// Joins the per-folder lists into one row per conversation, listing every folder it appears in.
export function mergeInboxFolders(lists: Partial<Record<InboxFolder, ListedConversation[]>>): InboxRow[] {
  const byId = new Map<string, InboxRow>();
  for (const folder of INBOX_FOLDERS) {
    for (const item of lists[folder] ?? []) {
      const existing = byId.get(item.contactId);
      if (existing) {
        if (!existing.folders.includes(folder)) existing.folders.push(folder);
        continue;
      }
      byId.set(item.contactId, {
        contact_id: item.contactId,
        name: (item.name ?? '').trim(),
        email: item.email?.trim() || null,
        phone: normalizePhone(item.phone ?? ''),
        folders: [folder],
      });
    }
  }
  return [...byId.values()];
}

export interface InboxDetails {
  last_message: string | null;
  last_message_at: string | null;
  last_direction: string | null;
  labels: string[];
}

// Builds the Inbox detail columns from the newest message (the conversation is read newest first) and the
// contact's label ids. Label ids that have no name in the account are left out. Text is capped at 500 characters.
export function toInboxDetails(newest: ConversationItem | undefined, labelIds: string[], labelNames: Map<string, string>): InboxDetails {
  const text = (newest?.content ?? '').replace(/\s+/g, ' ').trim();
  return {
    last_message: newest ? (text.length > 500 ? `${text.slice(0, 497)}...` : text) || (newest.type === 'call' ? 'Call' : null) : null,
    last_message_at: newest?.createdAt ?? null,
    last_direction: newest?.direction ?? null,
    labels: labelIds.map((id) => labelNames.get(id)).filter((name): name is string => !!name),
  };
}

// A message as read_conversation returns it (the fields the thread shows).
export interface ThreadItem extends ConversationItem {
  id: string;
  status?: string;
  fromNumber?: string;
  toNumber?: string;
  attachments?: unknown[];
}

export interface MessageRow {
  message_id: string;
  contact_id: string;
  direction: 'incoming' | 'outgoing';
  type: string;
  content: string;
  status: string | null;
  source: string | null;
  from_number: string | null;
  to_number: string | null;
  attachment_count: number;
  created_at: string;
}

// One stored message for the Inbox thread. Attachment links are dropped (they expire); only the count is kept.
// Returns null for items that are not sent or received messages (for example call entries without a direction).
export function toMessageRow(contactId: string, item: ThreadItem): MessageRow | null {
  if (!item.id || (item.direction !== 'incoming' && item.direction !== 'outgoing') || !item.createdAt) return null;
  const content = (item.content ?? '').trim();
  return {
    message_id: item.id,
    contact_id: contactId,
    direction: item.direction,
    type: item.type || 'sms',
    content: content.length > 2000 ? `${content.slice(0, 1997)}...` : content,
    status: item.status ?? null,
    source: item.source ?? null,
    from_number: item.fromNumber ?? null,
    to_number: item.toNumber ?? null,
    attachment_count: Array.isArray(item.attachments) ? item.attachments.length : 0,
    created_at: item.createdAt,
  };
}

// Returns null when the contact was never in a campaign, or when its phone number is not usable.
export function toSyncRow(contact: ContactSummary, items: ConversationItem[]): SyncRow | null {
  const phone = normalizePhone(contact.phone);
  if (!phone) return null;

  const campaign = items.filter((item) => item.source === 'campaign' && CAMPAIGN_TYPES.has(item.type));
  if (campaign.length === 0) return null;

  const newest = campaign.reduce((latest, item) => (Date.parse(item.createdAt) > Date.parse(latest) ? item.createdAt : latest), campaign[0].createdAt);
  const replies = campaign.filter((item) => item.direction === 'incoming');

  return {
    phone,
    name: contact.name.trim(),
    last_campaign_at: newest,
    replied: replies.length > 0,
    opted_out: replies.some((item) => isOptOutReply(item.content)),
  };
}
