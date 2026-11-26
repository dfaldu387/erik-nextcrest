-- NextCrest migration 029
-- Moves the SmarterContact sync to Supabase (supabase/functions/smartercontact-sync), so it no longer needs this PC.
--
--   sc_auth          the SmarterContact sign-in (refresh token). Row-level security is on with no policies, so only
--                    the service role (the sync function) can read or change it. Signed-in app users cannot.
--   sc_sync_state    small key/value status the sync keeps (last cycle, last error, the top of the inbox).
--                    Signed-in users can read it, so the app can show when the sync last ran.
--   sc_open_refresh  when each conversation was last read because someone opened it (one read a minute at most).
--
-- The scheduled job (pg_cron calling the function every minute) is set up separately, because it needs the cron secret.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS sc_auth (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  client_id TEXT NOT NULL,
  token_endpoint TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sc_auth ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sc_auth FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS sc_sync_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sc_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sc_sync_state_read ON sc_sync_state;
CREATE POLICY sc_sync_state_read ON sc_sync_state FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON sc_sync_state FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS sc_open_refresh (
  contact_id TEXT PRIMARY KEY,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sc_open_refresh ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sc_open_refresh FROM anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
