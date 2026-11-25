// SmarterContact webhook receiver, as a Supabase Edge Function.
//
// Deploy: supabase functions deploy smartercontact-webhook --no-verify-jwt
// Secret:  supabase secrets set SMARTERCONTACT_WEBHOOK_SECRET=whsec_...
// URL:     https://<project-ref>.supabase.co/functions/v1/smartercontact-webhook
//
// Each delivery is checked against its signature, stored once (repeats are acknowledged), and then applied:
//   - an inbound reply updates the matching Inbox conversation and saves the message,
//   - a stop reply records an opt-out on the phone number,
//   - delivery reports are only stored for review.
// The logic mirrors server/webhook (the Node version), which the project tests cover.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const MAX_AGE_SECONDS = 2 * 60 * 60;
const OPT_OUT_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'OPT OUT', 'REMOVE ME'];

type Json = Record<string, unknown>;

function send(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

// X-SC-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
async function verifySignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  const parts: Record<string, string> = {};
  for (const piece of header.split(',')) {
    const index = piece.indexOf('=');
    if (index > 0) parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1 || !/^\d+$/.test(t)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) >= MAX_AGE_SECONDS) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return constantTimeEqual(expected, v1);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function firstText(sources: Json[], keys: string[]): string {
  for (const source of sources) {
    for (const key of keys) {
      const value = text(source[key]);
      if (value) return value;
    }
  }
  return '';
}

// Keeps the ten digits of a US number. Eleven digits starting with 1 lose the country code.
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

// The payload layout is confirmed from the first real deliveries. These keys are the common shapes.
function parseEvent(body: Json) {
  const data = body.data && typeof body.data === 'object' ? (body.data as Json) : {};
  const contact = data.contact && typeof data.contact === 'object' ? (data.contact as Json) : {};
  const sources = [data, body];
  const eventId = firstText([body, data], ['id', 'event_id', 'eventId']);
  if (!eventId) return null;
  const eventType = firstText([body], ['type', 'event', 'event_type', 'eventType']);
  const isDelivery = eventType.toLowerCase().includes('delivery_status');
  const phoneKeys = isDelivery
    ? ['to_number', 'phone', 'phone_number', 'contact_phone']
    : ['from_number', 'phone', 'phone_number', 'from', 'contact_phone'];
  const phoneRaw = firstText([data, contact, body], phoneKeys);
  return {
    eventId,
    eventType,
    phone: phoneRaw ? normalizePhone(phoneRaw) : null,
    text: firstText(sources, ['message', 'text', 'body', 'content']),
    status: firstText(sources, ['status']),
    reason: firstText(sources, ['reason']),
    messageId: firstText([data, body], ['message_id', 'messageId']) || eventId,
    receivedAt: firstText([data, body], ['created_at', 'createdAt', 'timestamp']) || new Date().toISOString(),
  };
}

function isOptOutReply(message: string): boolean {
  const cleaned = message.toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return OPT_OUT_WORDS.includes(cleaned);
}

// Removes personal data and signed download links before an event is stored.
function redact(body: Json): Json {
  const top = { ...body };
  delete top.email;
  if (top.data && typeof top.data === 'object') {
    const data = { ...(top.data as Json) };
    if (Array.isArray(data.attachments)) {
      data.attachments = data.attachments.map((a) => {
        if (!a || typeof a !== 'object') return a;
        const { url: _url, ...rest } = a as Json;
        return { ...rest, url_redacted: true };
      });
    }
    top.data = data;
  }
  return top;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return send(405, { error: 'method not allowed' });

  const secret = Deno.env.get('SMARTERCONTACT_WEBHOOK_SECRET') ?? '';
  const rawBody = await req.text();
  if (rawBody.length > 1_000_000) return send(413, { error: 'body too large' });
  if (!(await verifySignature(rawBody, req.headers.get('x-sc-signature'), secret))) {
    return send(401, { error: 'unauthorized' });
  }

  let body: Json;
  try {
    body = JSON.parse(rawBody) as Json;
  } catch {
    return send(400, { error: 'body is not JSON' });
  }
  const event = parseEvent(body);
  if (!event) return send(400, { error: 'event id missing' });

  // The service role key is provided to Edge Functions automatically. It never leaves the server.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // Store once. A repeat delivery hits the unique event id and is acknowledged without being applied again.
  const stored = await db
    .from('webhook_events')
    .insert({ event_id: event.eventId, event_type: event.eventType, payload: redact(body), status: 'received' })
    .select('id')
    .single();
  if (stored.error) {
    if (stored.error.code === '23505') return send(200, { status: 'duplicate' });
    return send(500, { error: 'could not store the event' });
  }

  const type = event.eventType.toLowerCase();
  let action = 'ignore';
  try {
    const phone = event.phone;
    if (type.includes('delivery_status')) {
      action = 'delivery';
    } else if (type.startsWith('message.received') || /reply|received/.test(type)) {
      if (phone && isOptOutReply(event.text)) {
        action = 'opt_out';
        await recordOptOut(db, phone, event.eventId);
      } else {
        action = 'reply';
        if (phone) await applyReply(db, event, phone);
      }
    }
    await db.from('webhook_events').update({ status: action === 'ignore' ? 'ignored' : 'processed', note: action }).eq('id', stored.data.id);
    return send(200, { status: action });
  } catch (error) {
    const note = error instanceof Error ? error.message : 'processing failed';
    await db.from('webhook_events').update({ status: 'failed', note }).eq('id', stored.data.id);
    // A 500 makes Smarter Contact retry the delivery. The event is stored as failed and is retried.
    return send(500, { error: 'processing failed' });
  }
});

// A stop reply: the number is marked opted out, and the property (if matched) follows.
async function recordOptOut(db: SupabaseClient, phone: string, eventId: string) {
  const upsert = await db.from('phone_numbers').upsert({ phone_number: phone }, { onConflict: 'phone_number', ignoreDuplicates: true });
  if (upsert.error) throw new Error(`phone number could not be saved: ${upsert.error.message}`);
  const found = await db.from('phone_numbers').select('id').eq('phone_number', phone).single();
  if (found.error || !found.data) throw new Error('phone number could not be read back');
  const suppressed = await db.from('phone_suppressions').upsert(
    { phone_number_id: found.data.id, suppression_type: 'opt_out', source: `smartercontact:${eventId}` },
    { onConflict: 'phone_number_id,suppression_type', ignoreDuplicates: true },
  );
  if (suppressed.error) throw new Error(`opt-out could not be saved: ${suppressed.error.message}`);
}

// An inbound reply: the Inbox conversation for that phone number gets the reply as its latest message.
async function applyReply(db: SupabaseClient, event: NonNullable<ReturnType<typeof parseEvent>>, phone: string) {
  const conversation = await db
    .from('smartercontact_conversations')
    .select('contact_id')
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();
  if (conversation.error) throw new Error(`conversation lookup failed: ${conversation.error.message}`);
  if (!conversation.data) return; // not in the Inbox yet; the next inbox sync will add it

  const contactId = conversation.data.contact_id as string;
  const content = event.text || '';
  const message = await db.from('smartercontact_messages').upsert(
    {
      message_id: event.messageId,
      contact_id: contactId,
      direction: 'incoming',
      type: 'sms',
      content,
      status: null,
      source: 'campaign',
      from_number: phone,
      to_number: null,
      attachment_count: 0,
      created_at: event.receivedAt,
    },
    { onConflict: 'message_id' },
  );
  if (message.error) throw new Error(`message could not be saved: ${message.error.message}`);

  const updated = await db
    .from('smartercontact_conversations')
    .update({ last_message: content.slice(0, 500), last_message_at: event.receivedAt, last_direction: 'incoming', updated_at: new Date().toISOString() })
    .eq('contact_id', contactId);
  if (updated.error) throw new Error(`conversation could not be updated: ${updated.error.message}`);
}
