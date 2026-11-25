-- 013_webhook_events.sql
-- Log of Smarter Contact webhook events (replies and opt-outs). Each event is stored once, by its event ID,
-- so a retried delivery is never processed twice. Only the server (service role) reads or writes this table.

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received ON webhook_events (received_at DESC);

-- No policies: signed-in app users cannot read or write this table. The webhook function uses the service role.
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Tell the Supabase API to pick up the new table.
NOTIFY pgrst, 'reload schema';
