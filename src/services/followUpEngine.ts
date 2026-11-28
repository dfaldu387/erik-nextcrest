import { supabase } from '@/lib/supabase';
import { chatBookingStatus, localDateKey, suggestFollowUpDate, UPCOMING_DAYS } from '@/lib/followUpSchedule';

export interface ScheduledFollowUp {
  propertyId: string;
  followUpOn: string;
  note: string | null;
  ownerName: string;
  state: string;
  county: string;
}

export interface AppAlert {
  id: string;
  kind: string;
  message: string;
  createdAt: string;
}

type Result = { ok: true } | { ok: false; message: string };

/**
 * A property texted within this many days is already in the automatic campaign (the 24-hour and day-7 texts), so it is not
 * shown for a manual follow-up. Eight days covers the day-7 text plus a day of margin.
 */
export const RECENT_TOUCH_DAYS = 8;

const NOT_CONNECTED = 'NextCrest is not connected to its database.';

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

// The embedded property can come back as an object or a one-item array, depending on the join.
function firstProperty(value: unknown): { owner_name?: string | null; state?: string; county?: string } {
  if (Array.isArray(value)) return (value[0] ?? {}) as { owner_name?: string | null; state?: string; county?: string };
  return (value ?? {}) as { owner_name?: string | null; state?: string; county?: string };
}

/** Due: dated today or earlier. Upcoming: within the next UPCOMING_DAYS days. */
export async function listScheduledFollowUps(bucket: 'due' | 'upcoming', limit = 6): Promise<ScheduledFollowUp[]> {
  if (!supabase) return [];
  const today = localDateKey();
  let query = supabase
    .from('property_follow_ups')
    .select('property_id, follow_up_on, note, properties(owner_name, state, county)')
    .order('follow_up_on', { ascending: true })
    .limit(limit);
  query = bucket === 'due'
    ? query.lte('follow_up_on', today)
    : query.gt('follow_up_on', today).lte('follow_up_on', addDays(UPCOMING_DAYS));
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const p = firstProperty(row.properties);
    return {
      propertyId: row.property_id as string,
      followUpOn: row.follow_up_on as string,
      note: (row.note as string | null) ?? null,
      ownerName: p.owner_name ?? '',
      state: p.state ?? '',
      county: p.county ?? '',
    };
  });
}

export async function countScheduledFollowUps(): Promise<{ due: number; upcoming: number }> {
  if (!supabase) return { due: 0, upcoming: 0 };
  const today = localDateKey();
  const [due, upcoming] = await Promise.all([
    supabase.from('property_follow_ups').select('property_id', { count: 'exact', head: true }).lte('follow_up_on', today),
    supabase
      .from('property_follow_ups')
      .select('property_id', { count: 'exact', head: true })
      .gt('follow_up_on', today)
      .lte('follow_up_on', addDays(UPCOMING_DAYS)),
  ]);
  if (due.error || upcoming.error) throw new Error((due.error ?? upcoming.error)?.message ?? 'Could not count follow-ups.');
  return { due: due.count ?? 0, upcoming: upcoming.count ?? 0 };
}

export async function getPropertyFollowUp(propertyId: string): Promise<{ followUpOn: string; note: string | null } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('property_follow_ups')
    .select('follow_up_on, note')
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { followUpOn: data.follow_up_on as string, note: (data.note as string | null) ?? null } : null;
}

export async function setPropertyFollowUp(propertyId: string, followUpOn: string, note: string | null): Promise<Result> {
  if (!supabase) return { ok: false, message: NOT_CONNECTED };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(followUpOn)) return { ok: false, message: 'Choose a valid date.' };
  const { error } = await supabase
    .from('property_follow_ups')
    .upsert({ property_id: propertyId, follow_up_on: followUpOn, note: note?.trim() || null, set_at: new Date().toISOString() }, { onConflict: 'property_id' });
  return error ? { ok: false, message: 'The follow-up could not be saved. Try again.' } : { ok: true };
}

/** Marks the follow-up done (or cancels it). The row is deleted, so the property leaves the schedule. */
export async function clearPropertyFollowUp(propertyId: string): Promise<Result> {
  if (!supabase) return { ok: false, message: NOT_CONNECTED };
  const { error } = await supabase.from('property_follow_ups').delete().eq('property_id', propertyId);
  return error ? { ok: false, message: 'The follow-up could not be cleared. Try again.' } : { ok: true };
}

export interface ChatDateSuggestion {
  followUpOn: string;
  /** The words in the message that gave the date. */
  phrase: string;
  /** When the message was sent. */
  sentAt: string;
  /** 'booked' (date is ahead), or 'overdue' (date passed and our team has not replied since). */
  status: 'booked' | 'overdue';
  /** The seller has written since the date, but our team has not replied. Shown as a warning; it does not complete the follow-up. */
  sellerRepliedSince: boolean;
}

/**
 * The most recent date we set in the chat for this property's conversations: a message we sent that names a call or visit.
 * "Follow Up On" is not set in SmarterContact, so the chat is the source. A date is skipped once the chat has messages after it.
 * Returns null when nothing is found.
 */
export async function getChatDateSuggestion(propertyId: string): Promise<ChatDateSuggestion | null> {
  if (!supabase) return null;
  const links = await supabase.from('sc_conversation_properties').select('contact_id').eq('property_id', propertyId);
  if (links.error) throw new Error(links.error.message);
  const contactIds = [...new Set((links.data ?? []).map((row) => row.contact_id as string))];
  if (contactIds.length === 0) return null;

  // Both directions: the newest message of any kind tells us whether the chat has moved on past a date.
  const messages = await supabase
    .from('smartercontact_messages')
    .select('content, created_at, direction')
    .in('contact_id', contactIds)
    .order('created_at', { ascending: false })
    .limit(300);
  if (messages.error) throw new Error(messages.error.message);

  const rows = messages.data ?? [];
  // Only our messages can complete a follow-up. The seller's replies are checked separately, as a warning.
  const latestOutgoing = rows.find((m) => m.direction === 'outgoing')?.created_at as string | undefined;
  const latestIncoming = rows.find((m) => m.direction === 'incoming')?.created_at as string | undefined;
  for (const message of rows) {
    if (message.direction !== 'outgoing') continue;
    const content = message.content as string | null;
    const sentAt = message.created_at as string;
    if (!content) continue;
    const found = suggestFollowUpDate(content, new Date(sentAt));
    if (!found) continue;
    const status = chatBookingStatus(found.followUpOn, latestOutgoing ?? null);
    if (status === 'handled') continue;
    const sellerRepliedSince = !!latestIncoming && localDateKey(new Date(latestIncoming)) > found.followUpOn;
    return { followUpOn: found.followUpOn, phrase: found.phrase, sentAt, status, sellerRepliedSince };
  }
  return null;
}

export interface TouchSummary {
  outgoingTouches: number;
  incomingReplies: number;
  lastOutgoingAt: string | null;
  lastIncomingAt: string | null;
}

/** Touch counts for every property with synced messages, keyed by property id. Read in pages. */
export async function getTouchSummaryMap(): Promise<Record<string, TouchSummary>> {
  if (!supabase) return {};
  const result: Record<string, TouchSummary> = {};
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('property_touch_summary')
      .select('property_id, outgoing_touches, incoming_replies, last_outgoing_at, last_incoming_at')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      result[row.property_id as string] = {
        outgoingTouches: Number(row.outgoing_touches ?? 0),
        incomingReplies: Number(row.incoming_replies ?? 0),
        lastOutgoingAt: (row.last_outgoing_at as string | null) ?? null,
        lastIncomingAt: (row.last_incoming_at as string | null) ?? null,
      };
    }
    if ((data ?? []).length < pageSize) break;
  }
  return result;
}

/** True when we sent a message in the last `days` days. Such a property is already in an automatic campaign. */
export function isRecentlyTexted(lastOutgoingAt: string | null | undefined, days = RECENT_TOUCH_DAYS, now: Date = new Date()): boolean {
  if (!lastOutgoingAt) return false;
  return now.getTime() - new Date(lastOutgoingAt).getTime() < days * 86_400_000;
}

export async function listOpenAlerts(): Promise<AppAlert[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('app_alerts')
    .select('id, kind, message, created_at')
    .is('resolved_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind as string,
    message: row.message as string,
    createdAt: row.created_at as string,
  }));
}

/** Opens an alert of this kind, or refreshes the message of the one already open. */
export async function raiseAlert(kind: string, message: string): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase.from('app_alerts').select('id').eq('kind', kind).is('resolved_at', null).maybeSingle();
  if (data) {
    await supabase.from('app_alerts').update({ message, created_at: new Date().toISOString() }).eq('id', data.id);
  } else {
    await supabase.from('app_alerts').insert({ kind, message });
  }
}

export async function resolveAlert(kind: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('app_alerts').update({ resolved_at: new Date().toISOString() }).eq('kind', kind).is('resolved_at', null);
}
