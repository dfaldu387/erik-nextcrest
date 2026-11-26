// Smarter Contact REST API client, built from api-1.yaml (every operation in the spec).
// Server side only: it needs the sign-in token, so it runs in the Supabase Edge Function, never in the browser.
//
// - Requests start at least PACE_MS apart, so at most 2.5 per second. Reads are limited to 3 per second per account
//   per scope, and writes to 300 per hour per bucket, so the client never bursts.
// - A 401 renews the access token once (getAccessToken(true)) and retries.
// - A non-2xx answer throws SmarterContactApiError with the spec's code, reason, message and retry_after_seconds.
// - Only the sync calls the read methods. Write methods are provided, not called anywhere yet: sending a reply,
//   enrolling in a workflow, changing labels or fields and creating contacts all change live data.

export const SC_REST_BASE = 'https://api.smartercontact.com/rest';
const PACE_MS = 400;

export type Scope =
  | 'contacts:read'
  | 'conversations:read'
  | 'messages:write'
  | 'webhooks:read'
  | 'drafts:write'
  | 'conversations:write'
  | 'metadata:write'
  | 'contacts:write'
  | 'workflows:read'
  | 'workflows:write';

export class SmarterContactApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public reason: string | undefined,
    message: string,
    public retryAfterSeconds: number | undefined,
    public workflowId: string | undefined,
  ) {
    super(`SmarterContact ${status} ${code}${reason ? ` (${reason})` : ''}: ${message}`);
  }
}

// ---------- shapes from the spec (snake_case, as the API returns them) ----------

export interface ConversationItem {
  contact_id: string;
  account_id?: string;
  name?: string;
  email?: string;
  phone?: string;
}
export interface ConversationPage {
  items: ConversationItem[];
  next_page_token?: string;
  marked_read?: boolean;
  marked_read_reason?: 'no_conversation' | 'not_marked';
}
export interface MessageAttachment {
  index: number;
  content_type: string;
  url: string;
}
export interface Message {
  id: string;
  direction: 'incoming' | 'outgoing';
  type: string;
  content?: string;
  attachments?: MessageAttachment[];
  status?: string;
  created_at: string;
  source?: 'campaign' | 'workflow' | 'direct';
  from_number?: string;
  to_number?: string;
  duration_seconds?: number;
  dialer_campaign_name?: string;
}
export interface MessagePage {
  items: Message[];
  next_page_token?: string;
  marked_read?: boolean;
  marked_read_reason?: 'no_conversation' | 'not_marked';
}
export interface Contact {
  id: string;
  status: 'active' | 'deleted';
  created_at?: string;
  phone?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  deal_closed?: boolean;
  opt_out?: boolean;
  can_be_messaged?: boolean;
  fields?: { name: string; value: string }[];
  label_ids?: string[];
}
export interface ContactFields {
  contact_id: string;
  fields: { id: string; name: string; value: string }[];
}
export interface Label {
  id: string;
  name: string;
  types: ('messaging' | 'calling')[];
}
export interface LabelPage {
  items: Label[];
  next_page_token?: string;
}
export type SiPlaybook = 're' | 'hs' | 'roofing' | 'solar' | 'financing' | 'leadgen' | 'foreclosure' | 'other';
export type SiTone = 'friendly' | 'formal' | 'direct';
export interface SiSettings {
  playbook: SiPlaybook;
  writing_style: 'proven';
  tone: SiTone;
}
export interface DraftResult {
  draft_request_id: string;
  contact_id: string;
  status: 'generating' | 'ready' | 'needs_human_attention' | 'failed';
  text?: string;
  error?: { code: string; reason?: string; message: string };
}
export interface WorkflowMessage {
  body: string;
  delay_days: number;
  delivery_window: { days: number[]; from: string; to: string };
  reply_action: { when: 'reply' | 'sms_reply' | 'call_reply' | 'no_reply'; group_id: string | null; label_id: string | null } | null;
}
export interface Workflow {
  id: string;
  name: string;
  created_at: string;
  messages: WorkflowMessage[];
}
export interface WorkflowPage {
  items: Workflow[];
  next_page_token?: string;
}
export interface ContactEnrollments {
  items: { resource: string; resource_id: string; resource_name: string }[];
  message?: string;
}
export interface WorkflowEnrollment {
  workflow_id: string;
  workflow_name: string;
  contact_id: string;
  created_at?: string;
}
export interface WebhookEndpoint {
  id: string;
  name?: string;
  status: 'active' | 'inactive';
  events: string[];
  url: string;
}

// ---------- the client ----------

export interface ClientOptions {
  /** A valid access token. Called with force = true after a 401 to renew it. */
  getAccessToken: (force?: boolean) => Promise<string>;
  /** Pause between requests. Default 400 ms. */
  paceMs?: number;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined>;

export class SmarterContactApi {
  private readonly getAccessToken: (force?: boolean) => Promise<string>;
  private readonly paceMs: number;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private nextStartAt = 0;
  // Set from X-RateLimit-Remaining / X-RateLimit-Reset when the allowance is nearly used up: no request is sent before it.
  private nextAllowedAt = 0;

  constructor(options: ClientOptions) {
    this.getAccessToken = options.getAccessToken;
    this.paceMs = options.paceMs ?? PACE_MS;
    this.baseUrl = options.baseUrl ?? SC_REST_BASE;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  // Requests start at least paceMs apart (so no more than 1 / paceMs starts per second), and may overlap while
  // they wait for SmarterContact to answer. Nothing starts before the rate-limit hold (nextAllowedAt).
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const startAt = Math.max(now, this.nextStartAt, this.nextAllowedAt);
    this.nextStartAt = startAt + this.paceMs;
    const wait = startAt - now;
    return (wait > 0 ? new Promise<void>((resolve) => setTimeout(resolve, wait)) : Promise.resolve()).then(task);
  }

  private async request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, options: { query?: Query; body?: unknown } = {}): Promise<T> {
    return this.enqueue(async () => {
      const url = new URL(this.baseUrl + path);
      for (const [key, value] of Object.entries(options.query ?? {})) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
      }
      const send = async (token: string) =>
        this.fetchFn(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });

      let response = await send(await this.getAccessToken(false));
      if (response.status === 401) {
        // The token was rejected: renew it once and send again, still inside this queued request.
        response = await send(await this.getAccessToken(true));
      }
      // Nearly out of allowance for this window: hold the next request until the window resets (at most 60 s).
      const remaining = response.headers.get('X-RateLimit-Remaining');
      const reset = Number(response.headers.get('X-RateLimit-Reset'));
      if (remaining !== null && Number(remaining) <= 1 && Number.isFinite(reset) && reset > 0) {
        this.nextAllowedAt = Math.min(reset * 1000, Date.now() + 20_000);
      }

      if (response.status === 204) return undefined as T;

      const text = await response.text();
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      if (!response.ok) {
        const retryAfter = Number(body.retry_after_seconds ?? response.headers.get('Retry-After'));
        throw new SmarterContactApiError(
          response.status,
          String(body.code ?? 'internal_error'),
          body.reason as string | undefined,
          String(body.message ?? response.statusText),
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
          body.workflow_id as string | undefined,
        );
      }
      return body as T;
    });
  }

  /** Collects every page of a list endpoint, up to `max` items. */
  private async collect<T, P extends { items: T[]; next_page_token?: string }>(fetchPage: (token?: string) => Promise<P>, max = Infinity): Promise<T[]> {
    const items: T[] = [];
    let token: string | undefined;
    do {
      const page = await fetchPage(token);
      items.push(...page.items);
      token = page.next_page_token;
    } while (token && items.length < max);
    return items.slice(0, max);
  }

  // ----- conversations (conversations:read; conversations:write for setConversationsRead) -----

  /** GET /conversations/v1. Pass markRead only when you mean to change the read state. */
  listConversations(params: { category?: string; limit?: number; nextPageToken?: string; markRead?: boolean } = {}): Promise<ConversationPage> {
    return this.request('GET', '/conversations/v1', {
      query: { category: params.category, limit: params.limit, next_page_token: params.nextPageToken, mark_read: params.markRead },
    });
  }

  /** Every conversation in one folder, newest first, up to max. */
  listAllConversations(category: string, max = Infinity): Promise<ConversationItem[]> {
    return this.collect((token) => this.listConversations({ category, limit: 100, nextPageToken: token }), max);
  }

  /** POST /conversations/v1/read. Marks the named conversations read (true) or unread (false). */
  setConversationsRead(contactIds: string[], read: boolean): Promise<{ contact_ids: string[]; read: boolean }> {
    return this.request('POST', '/conversations/v1/read', { body: { contact_ids: contactIds, read } });
  }

  // ----- messages (conversations:read; messages:write for sendReply) -----

  /** GET /contacts/v1/{id}/messages. Newest first. markRead is never sent unless passed. */
  getMessages(contactId: string, params: { limit?: number; nextPageToken?: string; markRead?: boolean } = {}): Promise<MessagePage> {
    return this.request('GET', `/contacts/v1/${encodeURIComponent(contactId)}/messages`, {
      query: { limit: params.limit, next_page_token: params.nextPageToken, mark_read: params.markRead },
    });
  }

  /** POST /contacts/v1/{id}/messages. Sends a text. Changes live data: call only on a person's instruction. */
  sendReply(contactId: string, content: string): Promise<Message> {
    return this.request('POST', `/contacts/v1/${encodeURIComponent(contactId)}/messages`, { body: { content } });
  }

  // ----- contacts (contacts:read / contacts:write / metadata:write) -----

  /** GET /contacts/v1?phone=. Exact match; empty when no contact has the number. */
  lookupContactsByPhone(phone: string): Promise<{ items: Contact[] }> {
    return this.request('GET', '/contacts/v1', { query: { phone } });
  }

  /** POST /contacts/v1. Creates a contact. Changes live data. */
  createContact(body: { phone: string; first_name?: string; last_name?: string; email?: string }): Promise<Contact> {
    return this.request('POST', '/contacts/v1', { body });
  }

  /** GET /contacts/v1/{id}. Includes label_ids (label names are not returned). */
  getContact(contactId: string): Promise<Contact> {
    return this.request('GET', `/contacts/v1/${encodeURIComponent(contactId)}`);
  }

  /** PUT /contacts/v1/{id}/labels. Replaces the contact's labels. Changes live data. */
  setContactLabels(contactId: string, labelIds: string[]): Promise<{ contact_id: string; label_ids: string[] }> {
    return this.request('PUT', `/contacts/v1/${encodeURIComponent(contactId)}/labels`, { body: { label_ids: labelIds } });
  }

  /** GET /contacts/v1/{id}/fields. Standard fields only. */
  getContactFields(contactId: string): Promise<ContactFields> {
    return this.request('GET', `/contacts/v1/${encodeURIComponent(contactId)}/fields`);
  }

  /** PUT /contacts/v1/{id}/fields. Sets standard fields by id. Changes live data. */
  setContactFields(contactId: string, fields: Record<string, string>): Promise<ContactFields> {
    return this.request('PUT', `/contacts/v1/${encodeURIComponent(contactId)}/fields`, { body: { fields } });
  }

  // ----- labels (contacts:read) -----

  /** GET /labels/v1, one page. */
  listLabels(params: { type?: 'messaging' | 'calling'; limit?: number; nextPageToken?: string } = {}): Promise<LabelPage> {
    return this.request('GET', '/labels/v1', { query: { type: params.type, limit: params.limit, next_page_token: params.nextPageToken } });
  }

  /** Every label of the account, as a map from id to name. */
  async labelNames(): Promise<Map<string, string>> {
    const labels = await this.collect<Label, LabelPage>((token) => this.listLabels({ limit: 100, nextPageToken: token }));
    return new Map(labels.map((label) => [label.id, label.name]));
  }

  // ----- workflows (workflows:read / workflows:write) -----

  /** GET /workflows/v1, one page. */
  listWorkflows(params: { limit?: number; nextPageToken?: string } = {}): Promise<WorkflowPage> {
    return this.request('GET', '/workflows/v1', { query: { limit: params.limit, next_page_token: params.nextPageToken } });
  }

  /** GET /contacts/v1/{id}/enrollments. */
  listContactEnrollments(contactId: string): Promise<ContactEnrollments> {
    return this.request('GET', `/contacts/v1/${encodeURIComponent(contactId)}/enrollments`);
  }

  /** POST /workflows/v1/{id}/enrollments. Schedules messages and charges. Changes live data. */
  enrollContactInWorkflow(workflowId: string, contactId: string): Promise<WorkflowEnrollment> {
    return this.request('POST', `/workflows/v1/${encodeURIComponent(workflowId)}/enrollments`, { body: { contact_id: contactId } });
  }

  /** DELETE /workflows/v1/{id}/enrollments/{contact_id}. Changes live data. Returns nothing (204). */
  removeContactFromWorkflow(workflowId: string, contactId: string): Promise<void> {
    return this.request('DELETE', `/workflows/v1/${encodeURIComponent(workflowId)}/enrollments/${encodeURIComponent(contactId)}`);
  }

  // ----- SI drafts and settings (drafts:write) -----

  /** POST /drafts/v1. Starts a draft; nothing is sent. Charged when the draft is ready. */
  requestDraft(body: { conversation_id: string; user_draft?: string; prior_drafts?: string[]; mode?: 'generate' | 'followup' | 'rewrite' | 'followup_rewrite' }): Promise<DraftResult> {
    return this.request('POST', '/drafts/v1', { body });
  }

  /** GET /drafts/v1/{id}. Not charged. */
  getDraftResult(draftRequestId: string): Promise<DraftResult> {
    return this.request('GET', `/drafts/v1/${encodeURIComponent(draftRequestId)}`);
  }

  /** GET /si-settings/v1. */
  getSiSettings(): Promise<SiSettings> {
    return this.request('GET', '/si-settings/v1');
  }

  /** PATCH /si-settings/v1. Changes the playbook and/or tone. */
  updateSiSettings(body: { playbook?: SiPlaybook; tone?: SiTone }): Promise<SiSettings> {
    return this.request('PATCH', '/si-settings/v1', { body });
  }

  // ----- webhook endpoints (webhooks:read) -----

  /** GET /webhooks/v1. */
  listWebhooks(): Promise<{ items: WebhookEndpoint[] }> {
    return this.request('GET', '/webhooks/v1');
  }
}
