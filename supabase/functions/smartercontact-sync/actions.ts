// Checks for the two actions the Inbox can request from the sync function: sending a reply and marking
// conversations read or unread. Pure functions, so the rules are tested without the network.

export const MAX_REPLY_CHARS = 1000; // one long SMS; longer texts are split by carriers and cost more
export const MAX_MARK_IDS = 100; // the API takes 1 to 100 contact ids per call

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns an error message, or null when the reply can be sent. The contact id is the conversation id (a UUID). */
export function checkReply(contactId: unknown, content: unknown): string | null {
  if (typeof contactId !== 'string' || !UUID.test(contactId)) return 'The conversation id is not valid.';
  if (typeof content !== 'string' || content.trim().length === 0) return 'The reply is empty.';
  if (content.trim().length > MAX_REPLY_CHARS) return `The reply is longer than ${MAX_REPLY_CHARS} characters.`;
  return null;
}

/** Returns an error message, or null when the mark request is valid. */
export function checkMark(contactIds: unknown, read: unknown): string | null {
  if (!Array.isArray(contactIds) || contactIds.length === 0) return 'No conversations were given.';
  if (contactIds.length > MAX_MARK_IDS) return `At most ${MAX_MARK_IDS} conversations can be marked at once.`;
  if (!contactIds.every((id) => typeof id === 'string' && UUID.test(id))) return 'A conversation id is not valid.';
  if (typeof read !== 'boolean') return 'Say whether to mark read or unread.';
  return null;
}

export const MAX_FIELD_CHARS = 500;

/** Returns an error message, or null when the field save is valid. Keys are SmarterContact field names. */
export function checkFields(contactId: unknown, fields: unknown): string | null {
  if (typeof contactId !== 'string' || !UUID.test(contactId)) return 'The conversation id is not valid.';
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return 'No fields were given.';
  const entries = Object.entries(fields as Record<string, unknown>);
  if (entries.length === 0) return 'No fields were given.';
  for (const [name, value] of entries) {
    if (name.trim().length === 0 || name.length > 100) return 'A field name is not valid.';
    if (typeof value !== 'string') return `The value of ${name} must be text.`;
    if (value.length > MAX_FIELD_CHARS) return `The value of ${name} is longer than ${MAX_FIELD_CHARS} characters.`;
  }
  return null;
}

/** Maps field names to the ids SmarterContact needs. Returns the ids, or the names that the contact does not have. */
export function fieldIdsFor(existing: { id: string; name: string }[], values: Record<string, string>): { ids: Record<string, string> } | { missing: string[] } {
  const idByName = new Map(existing.map((f) => [f.name, f.id]));
  const missing = Object.keys(values).filter((name) => !idByName.has(name));
  if (missing.length > 0) return { missing };
  return { ids: Object.fromEntries(Object.entries(values).map(([name, value]) => [idByName.get(name) as string, value])) };
}
