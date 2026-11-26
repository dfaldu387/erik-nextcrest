-- NextCrest migration 033
-- Several SmarterContact accounts (a primary account and its sub-accounts), each with its own sign-in.
--
--   sc_accounts              one row per SmarterContact account the sync reads. Holds the client credentials and the
--                            current access token. Row-level security is on with no policies: only the service role
--                            (the sync function) can read it.
--   smartercontact_conversations.account_id
--                            which account a conversation belongs to. Existing rows are the primary account.
--
-- A SmarterContact primary account only lists its own conversations, so each sub-account must be read with its own
-- sign-in. Opt-outs stay central: the suppression lists are not per account.

BEGIN;

CREATE TABLE IF NOT EXISTS sc_accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  profile_id TEXT,
  access_token TEXT,
  access_expires_at TIMESTAMP WITH TIME ZONE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE sc_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sc_accounts FROM anon, authenticated;

ALTER TABLE smartercontact_conversations ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'primary';
CREATE INDEX IF NOT EXISTS idx_sc_conversations_account ON smartercontact_conversations (account_id);

COMMIT;

NOTIFY pgrst, 'reload schema';
