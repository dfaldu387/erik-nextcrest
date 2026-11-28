-- NextCrest migration 053
-- Team access: which counties each SmarterContact account works, and admins can manage who is mapped to which account.
--
--   sc_account_counties   the counties assigned to one SmarterContact account (state + county).
--                         Everyone signed in can read it; only an admin can change it.
--   user_sc_accounts      (migration 051) gets admin write access, so admins can map users to accounts in the app.
--
-- Assignments are recorded here. Restricting which rows each user can read is a separate, later change.

BEGIN;

CREATE TABLE IF NOT EXISTS sc_account_counties (
  account_id TEXT NOT NULL REFERENCES sc_accounts(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  county TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, state, county)
);

ALTER TABLE sc_account_counties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sc_account_counties FROM anon, authenticated;
GRANT SELECT ON sc_account_counties TO authenticated;
GRANT INSERT, DELETE ON sc_account_counties TO authenticated;

DROP POLICY IF EXISTS sc_account_counties_read ON sc_account_counties;
CREATE POLICY sc_account_counties_read ON sc_account_counties
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS sc_account_counties_admin_write ON sc_account_counties;
CREATE POLICY sc_account_counties_admin_write ON sc_account_counties
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

GRANT INSERT, DELETE ON user_sc_accounts TO authenticated;

DROP POLICY IF EXISTS user_sc_accounts_admin_write ON user_sc_accounts;
CREATE POLICY user_sc_accounts_admin_write ON user_sc_accounts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS user_sc_accounts_admin_read ON user_sc_accounts;
CREATE POLICY user_sc_accounts_admin_read ON user_sc_accounts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

COMMIT;

NOTIFY pgrst, 'reload schema';
