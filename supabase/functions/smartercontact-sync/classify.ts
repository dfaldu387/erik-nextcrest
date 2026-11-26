// Reads a Smarter Contact webhook body and decides what it means. Pure functions with no platform APIs, so the
// same file runs in the Supabase Edge Function and in the project's tests.
//
// ASSUMPTION: the Smarter Contact payload layout is not confirmed yet (the REST reference could not be read).
// The reader accepts the common shapes: an event ID and type at the top level, and the phone and message text
// either at the top level or under "data". Replace the field names here once the real payload is known.

export type Decision =
  | { action: 'opt_out'; phone: string }
  | { action: 'reply'; phone: string | null }
  | { action: 'delivery'; phone: string | null; status: string; reason: string }
  | { action: 'ignore' };

export interface WebhookEvent {
  eventId: string;
  eventType: string;
  phone: string | null;
  text: string;
  status: string;
  reason: string;
}

// Replies that mean "stop texting me". Matched on the whole reply, ignoring case and punctuation.
export const OPT_OUT_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'OPT OUT', 'REMOVE ME'];

// Keeps the ten digits of a US number. Eleven digits starting with 1 lose the country code.
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function firstText(sources: Record<string, unknown>[], keys: string[]): string {
  for (const source of sources) {
    for (const key of keys) {
      const value = text(source[key]);
      if (value) return value;
    }
  }
  return '';
}

// Reads the event. Returns null when there is no event ID, because a duplicate could not be detected without one.
export function parseEvent(body: unknown): WebhookEvent | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const top = body as Record<string, unknown>;
  const data = top.data && typeof top.data === 'object' ? (top.data as Record<string, unknown>) : {};
  const contact = data.contact && typeof data.contact === 'object' ? (data.contact as Record<string, unknown>) : {};
  const sources = [data, top];

  const eventId = firstText([top, data], ['id', 'event_id', 'eventId']);
  if (!eventId) return null;

  const eventType = firstText([top], ['type', 'event', 'event_type', 'eventType']);
  // For a delivery report the contact is the recipient (to_number); for a reply it is the sender (from_number).
  const isDelivery = eventType.toLowerCase().includes('delivery_status');
  const phoneKeys = isDelivery ? ['to_number', 'phone', 'phone_number', 'contact_phone'] : ['from_number', 'phone', 'phone_number', 'from', 'contact_phone'];
  const phoneRaw = firstText([data, contact, top], phoneKeys);
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  const message = firstText(sources, ['message', 'text', 'body', 'content']);
  const status = firstText(sources, ['status']);
  const reason = firstText(sources, ['reason']);

  return { eventId, eventType, phone, text: message, status, reason };
}

// Turns "Stop!" or "  unsubscribe " into a comparable word.
function isOptOutReply(message: string): boolean {
  const cleaned = message.toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return OPT_OUT_WORDS.includes(cleaned);
}

export function classify(event: WebhookEvent): Decision {
  const type = event.eventType.toLowerCase();

  // A dedicated opt-out event, if Smarter Contact sends one.
  if (/opt(ed)?[._-]?out|unsubscribe/.test(type) && event.phone) {
    return { action: 'opt_out', phone: event.phone };
  }

  // A delivery report. Logged for review only: a carrier block such as 'spam' does not prove the number is wrong.
  if (type.includes('delivery_status')) {
    return { action: 'delivery', phone: event.phone, status: event.status, reason: event.reason };
  }

  // An inbound reply, such as message.received.v1.
  if (type.startsWith('message.received') || /reply|received/.test(type)) {
    if (isOptOutReply(event.text) && event.phone) {
      return { action: 'opt_out', phone: event.phone };
    }
    return { action: 'reply', phone: event.phone };
  }

  return { action: 'ignore' };
}

// Removes personal data and signed download links before an event is stored: the owner's email and attachment URLs.
// The phone number, reply text and IDs are kept, since the audit trail and matching need them.
export function redactPayload(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const top = { ...(body as Record<string, unknown>) };
  delete top.email;
  if (top.data && typeof top.data === 'object') {
    const data = { ...(top.data as Record<string, unknown>) };
    if (Array.isArray(data.attachments)) {
      data.attachments = data.attachments.map((a) => {
        if (!a || typeof a !== 'object') return a;
        const { url: _url, ...rest } = a as Record<string, unknown>;
        return { ...rest, url_redacted: true };
      });
    }
    top.data = data;
  }
  return top;
}
