// Smarter Contact webhook receiver. Runs inside this code repo as a small Node server.
//
//   npm run webhook
//
// Required environment variables (set them on the machine that runs the server, never in the browser bundle):
//   SMARTERCONTACT_WEBHOOK_SECRET  signing secret from the ConnectSI Webhooks tab (starts with whsec_)
//   SUPABASE_URL                   project URL
//   SUPABASE_SERVICE_ROLE_KEY      service role key, used only by this server
//   PORT                           optional, defaults to 8787
//
// Smarter Contact must reach this server over HTTPS, so it needs a public URL (a host or a tunnel).
// Smarter Contact retries until it gets a 2xx reply, and can send the same event more than once. Each event carries an
// id that repeats on every delivery, so a repeat is acknowledged and not processed again.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { classify, parseEvent, redactPayload } from './classify.ts';
import { verifySignature } from './signature.ts';

const PATH = '/smartercontact/webhook';
const MAX_BODY_BYTES = 1_000_000;

interface Deps {
  secret: string;
  db: SupabaseClient;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Reads the whole body. Resolves null when it is larger than the limit.
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Records an opt-out for the phone number. The number is created if we have not seen it before.
// The suppression is unique per number and type, so a repeat STOP changes nothing.
async function suppressOptOut(db: SupabaseClient, phone: string, eventId: string): Promise<void> {
  const upsertNumber = await db
    .from('phone_numbers')
    .upsert({ phone_number: phone }, { onConflict: 'phone_number', ignoreDuplicates: true });
  if (upsertNumber.error) throw new Error(`phone number could not be saved: ${upsertNumber.error.message}`);

  const found = await db.from('phone_numbers').select('id').eq('phone_number', phone).single();
  if (found.error || !found.data) throw new Error('phone number could not be read back');

  const suppressed = await db.from('phone_suppressions').upsert(
    { phone_number_id: found.data.id, suppression_type: 'opt_out', source: `smartercontact:${eventId}` },
    { onConflict: 'phone_number_id,suppression_type', ignoreDuplicates: true },
  );
  if (suppressed.error) throw new Error(`opt-out could not be saved: ${suppressed.error.message}`);
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse, deps: Deps): Promise<void> {
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

  const rawBody = await readBody(req);
  if (rawBody === null) return send(res, 413, { error: 'body too large' });

  // Verify against the raw bytes Smarter Contact sent, before any parsing.
  const valid = await verifySignature(rawBody, req.headers['x-sc-signature'] as string | undefined ?? null, deps.secret);
  if (!valid) return send(res, 401, { error: 'unauthorized' });

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return send(res, 400, { error: 'body is not JSON' });
  }

  const event = parseEvent(body);
  if (!event) return send(res, 400, { error: 'event id missing' });

  // Store the event once. A repeat hits the unique event ID and is acknowledged without being processed again.
  const stored = await deps.db
    .from('webhook_events')
    .insert({ event_id: event.eventId, event_type: event.eventType, payload: redactPayload(body), status: 'received' })
    .select('id')
    .single();
  if (stored.error) {
    if (stored.error.code === '23505') return send(res, 200, { status: 'duplicate' });
    return send(res, 500, { error: 'could not store the event' });
  }

  const decision = classify(event);
  try {
    if (decision.action === 'opt_out') {
      await suppressOptOut(deps.db, decision.phone, event.eventId);
    }
    await deps.db
      .from('webhook_events')
      .update({ status: decision.action === 'ignore' ? 'ignored' : 'processed', note: decision.action })
      .eq('id', stored.data.id);
    return send(res, 200, { status: decision.action });
  } catch (error) {
    const note = error instanceof Error ? error.message : 'processing failed';
    await deps.db.from('webhook_events').update({ status: 'failed', note }).eq('id', stored.data.id);
    // A 500 makes Smarter Contact retry the delivery. The event is stored as failed, and the retry is processed.
    return send(res, 500, { error: 'processing failed' });
  }
}

export function createWebhookServer(deps: Deps) {
  return createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true });
    if (path !== PATH) return send(res, 404, { error: 'not found' });
    handleWebhook(req, res, deps).catch(() => {
      if (!res.headersSent) send(res, 500, { error: 'unexpected error' });
    });
  });
}

// Starts the server when this file is run directly (npm run webhook).
if (process.argv[1]?.endsWith('server.ts')) {
  const secret = process.env.SMARTERCONTACT_WEBHOOK_SECRET;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !url || !key) {
    console.error('Set SMARTERCONTACT_WEBHOOK_SECRET, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before starting the webhook.');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const port = Number(process.env.PORT ?? 8787);
  createWebhookServer({ secret, db }).listen(port, () => {
    console.log(`Smarter Contact webhook listening on port ${port} at ${PATH}`);
  });
}
