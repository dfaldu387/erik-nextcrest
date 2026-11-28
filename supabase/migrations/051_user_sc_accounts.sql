-- NextCrest migration 051
-- Maps a NextCrest user to the SmarterContact accounts they work in (sc_accounts, migration 033).
-- Users can read their own mappings. Only the service role (admin tools) writes them.

BEGIN;

CREATE TABLE IF NOT EXISTS user_sc_accounts (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES sc_accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id)
);

ALTER TABLE user_sc_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_sc_accounts FROM anon, authenticated;
GRANT SELECT ON user_sc_accounts TO authenticated;

DROP POLICY IF EXISTS user_sc_accounts_read_own ON user_sc_accounts;
CREATE POLICY user_sc_accounts_read_own ON user_sc_accounts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMIT;

NOTIFY pgrst, 'reload schema';
