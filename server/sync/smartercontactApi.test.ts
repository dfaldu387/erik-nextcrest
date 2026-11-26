import { describe, expect, it } from 'vitest';
import { SmarterContactApi, SmarterContactApiError } from '../../supabase/functions/smartercontact-sync/api.ts';

function reply(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function makeApi(responses: Response[], tokens: string[] = ['tok-1']) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  let tokenIndex = 0;
  const api = new SmarterContactApi({
    paceMs: 0,
    baseUrl: 'https://example.test/rest',
    getAccessToken: async (force) => {
      if (force) tokenIndex = Math.min(tokenIndex + 1, tokens.length - 1);
      return tokens[tokenIndex];
    },
    fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET', headers: init?.headers as Record<string, string>, body: init?.body as string | undefined });
      const next = responses.shift();
      if (!next) throw new Error('unexpected extra request');
      return next;
    }) as typeof fetch,
  });
  return { api, calls };
}

describe('SmarterContactApi requests', () => {
  it('sends the bearer token and only the query values that are set', async () => {
    const { api, calls } = makeApi([reply(200, { items: [] })]);
    await api.listConversations({ category: 'unread', limit: 10 });
    expect(calls[0].url).toBe('https://example.test/rest/conversations/v1?category=unread&limit=10');
    expect(calls[0].headers.Authorization).toBe('Bearer tok-1');
  });

  it('never sends mark_read unless it is asked for', async () => {
    const { api, calls } = makeApi([reply(200, { items: [] }), reply(200, { items: [] })]);
    await api.getMessages('c-1', { limit: 5 });
    await api.listConversations({ category: 'all' });
    expect(calls.some((c) => c.url.includes('mark_read'))).toBe(false);
  });

  it('encodes contact ids in the path', async () => {
    const { api, calls } = makeApi([reply(200, { id: 'a b', status: 'active' })]);
    await api.getContact('a b');
    expect(calls[0].url).toBe('https://example.test/rest/contacts/v1/a%20b');
  });

  it('sends a JSON body for writes', async () => {
    const { api, calls } = makeApi([reply(200, { contacts_ids: [], read: true })]);
    await api.setConversationsRead(['c-1'], true);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ contact_ids: ['c-1'], read: true });
  });

  it('handles 204 with no body', async () => {
    const { api, calls } = makeApi([new Response(null, { status: 204 })]);
    await expect(api.removeContactFromWorkflow('w-1', 'c-1')).resolves.toBeUndefined();
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe('https://example.test/rest/workflows/v1/w-1/enrollments/c-1');
  });
});

describe('SmarterContactApi errors and renewal', () => {
  it('renews the token once after a 401 and retries inside the same request', async () => {
    const { api, calls } = makeApi([reply(401, { code: 'unauthorized', reason: 'token_invalid', message: 'bad token' }), reply(200, { items: [] })], ['tok-old', 'tok-new']);
    await api.listConversations({ category: 'all' });
    expect(calls).toHaveLength(2);
    expect(calls[1].headers.Authorization).toBe('Bearer tok-new');
  });

  it('throws the spec error with code, reason and retry time on 429', async () => {
    const { api } = makeApi([reply(429, { code: 'too_many_requests', reason: 'rate_limited', message: 'slow down', retry_after_seconds: 30 })]);
    const error = await api.listConversations().catch((e) => e);
    expect(error).toBeInstanceOf(SmarterContactApiError);
    expect(error.status).toBe(429);
    expect(error.code).toBe('too_many_requests');
    expect(error.reason).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('reports the workflow id on a 409 already_enrolled', async () => {
    const { api } = makeApi([reply(409, { code: 'conflict', reason: 'already_enrolled', message: 'already enrolled', workflow_id: 'w-9' })]);
    const error = await api.enrollContactInWorkflow('w-1', 'c-1').catch((e) => e);
    expect(error.code).toBe('conflict');
    expect(error.reason).toBe('already_enrolled');
    expect(error.workflowId).toBe('w-9');
  });
});

describe('SmarterContactApi pagination', () => {
  it('follows next_page_token until the last page', async () => {
    const { api, calls } = makeApi([
      reply(200, { items: [{ contact_id: 'c-1' }], next_page_token: 'p2' }),
      reply(200, { items: [{ contact_id: 'c-2' }] }),
    ]);
    const items = await api.listAllConversations('unread');
    expect(items.map((i) => i.contact_id)).toEqual(['c-1', 'c-2']);
    expect(calls[1].url).toContain('next_page_token=p2');
  });

  it('builds the label map from every page', async () => {
    const { api } = makeApi([
      reply(200, { items: [{ id: 'l-1', name: 'NI', types: ['messaging'] }], next_page_token: 'p2' }),
      reply(200, { items: [{ id: 'l-2', name: 'C-Mike', types: ['messaging'] }] }),
    ]);
    const names = await api.labelNames();
    expect(names.get('l-1')).toBe('NI');
    expect(names.get('l-2')).toBe('C-Mike');
  });
});

describe('SmarterContactApi rate-limit headers', () => {
  it('holds the next request until the window resets when the allowance is used up', async () => {
    // Reset is whole unix seconds, at least about 2 s away, so the wait is clearly measurable.
    const resetAt = Math.ceil((Date.now() + 2000) / 1000);
    const times: number[] = [];
    const responses = [
      new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(resetAt) } }),
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    ];
    const api = new SmarterContactApi({
      paceMs: 0,
      baseUrl: 'https://example.test/rest',
      getAccessToken: async () => 'tok',
      fetchFn: (async () => {
        times.push(Date.now());
        return responses.shift()!;
      }) as typeof fetch,
    });
    await api.listConversations();
    await api.listConversations();
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
  });
});
