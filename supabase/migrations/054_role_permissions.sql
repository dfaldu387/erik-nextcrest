-- NextCrest migration 054
-- Role permissions, and a fix to who can change a role.
--
-- Security fix: the "Users can update own profile" policy allowed every column, and signed-in users had table-wide
-- UPDATE on profiles. Any user could have set their own role to admin. Signed-in users may now update only their
-- name, avatar and timestamp. Roles change only through set_user_role(), which checks that the caller is an admin.
--
--   role_permissions   the access each role has to each area (what the Team page shows as "Roles and access").
--                      Everyone signed in can read it; only an admin can change it.
--   is_admin()         true when the signed-in user's profile has the admin role. Used by the policies below.
--   profiles           admins can read every profile, so the Team page lists the whole team.

BEGIN;

-- 1. Close the role escalation: column-level update for signed-in users, no role.
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_url, updated_at) ON profiles TO authenticated;

-- 2. Admin check. SECURITY DEFINER so it can read profiles without the profile policies recursing.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- 3. Admins can read every profile.
DROP POLICY IF EXISTS profiles_admin_read ON profiles;
CREATE POLICY profiles_admin_read ON profiles
  FOR SELECT TO authenticated
  USING (is_admin());

-- 4. The only way to change a role: admins, and only to a known role.
CREATE OR REPLACE FUNCTION set_user_role(p_user UUID, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only an admin can change roles';
  END IF;
  IF p_role NOT IN ('admin', 'data_manager', 'marketing_user', 'read_only') THEN
    RAISE EXCEPTION 'Unknown role: %', p_role;
  END IF;
  UPDATE profiles SET role = p_role, updated_at = now() WHERE id = p_user;
END;
$$;
GRANT EXECUTE ON FUNCTION set_user_role(UUID, TEXT) TO authenticated;

-- 5. The legacy 'user' role becomes 'read_only'.
UPDATE profiles SET role = 'read_only' WHERE role = 'user';

-- 6. The permission matrix.
CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  area TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('Full', 'View', 'Assigned only', 'Record only', 'None')),
  PRIMARY KEY (role, area)
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON role_permissions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON role_permissions TO authenticated;

DROP POLICY IF EXISTS role_permissions_read ON role_permissions;
CREATE POLICY role_permissions_read ON role_permissions
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS role_permissions_admin_write ON role_permissions;
CREATE POLICY role_permissions_admin_write ON role_permissions
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

INSERT INTO role_permissions (role, area, access) VALUES
  ('admin', 'Dashboard', 'Full'), ('admin', 'Properties', 'Full'), ('admin', 'Data Purchases and Import', 'Full'),
  ('admin', 'Duplicate Checker', 'Full'), ('admin', 'Lists and exports', 'Full'), ('admin', 'Campaigns', 'Full'),
  ('admin', 'Follow-ups and responders', 'Full'), ('admin', 'Opt-outs and wrong numbers', 'Full'), ('admin', 'Integrations', 'Full'),
  ('admin', 'Reports', 'Full'), ('admin', 'Team and settings', 'Full'),
  ('data_manager', 'Dashboard', 'Full'), ('data_manager', 'Properties', 'Full'), ('data_manager', 'Data Purchases and Import', 'Full'),
  ('data_manager', 'Duplicate Checker', 'Full'), ('data_manager', 'Lists and exports', 'Full'), ('data_manager', 'Campaigns', 'View'),
  ('data_manager', 'Follow-ups and responders', 'None'), ('data_manager', 'Opt-outs and wrong numbers', 'Full'), ('data_manager', 'Integrations', 'None'),
  ('data_manager', 'Reports', 'Full'), ('data_manager', 'Team and settings', 'None'),
  ('marketing_user', 'Dashboard', 'Full'), ('marketing_user', 'Properties', 'Assigned only'), ('marketing_user', 'Data Purchases and Import', 'None'),
  ('marketing_user', 'Duplicate Checker', 'None'), ('marketing_user', 'Lists and exports', 'Full'), ('marketing_user', 'Campaigns', 'View'),
  ('marketing_user', 'Follow-ups and responders', 'Full'), ('marketing_user', 'Opt-outs and wrong numbers', 'Record only'), ('marketing_user', 'Integrations', 'None'),
  ('marketing_user', 'Reports', 'None'), ('marketing_user', 'Team and settings', 'None'),
  ('read_only', 'Dashboard', 'View'), ('read_only', 'Properties', 'View'), ('read_only', 'Data Purchases and Import', 'None'),
  ('read_only', 'Duplicate Checker', 'None'), ('read_only', 'Lists and exports', 'None'), ('read_only', 'Campaigns', 'View'),
  ('read_only', 'Follow-ups and responders', 'View'), ('read_only', 'Opt-outs and wrong numbers', 'View'), ('read_only', 'Integrations', 'None'),
  ('read_only', 'Reports', 'View'), ('read_only', 'Team and settings', 'None')
ON CONFLICT (role, area) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
