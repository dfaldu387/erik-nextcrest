-- 008_exclusion_exports.sql
-- Export history for the pre-purchase exclusion file. Every file generated is recorded, so the team
-- can always tell which file was uploaded to Land Portal, and when.
--
-- Rows are append-only: there are no UPDATE or DELETE policies, so the history cannot be edited
-- or removed from the app.

CREATE TABLE IF NOT EXISTS exclusion_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL DEFAULT auth.uid(),
  state TEXT NOT NULL,
  counties TEXT[] NOT NULL,
  parcel_count INT NOT NULL CHECK (parcel_count >= 0),
  filename TEXT NOT NULL,
  file_format TEXT NOT NULL DEFAULT 'csv',
  matching_rule_version TEXT NOT NULL DEFAULT 'county+apn-v1'
);

CREATE INDEX IF NOT EXISTS idx_exclusion_exports_created_at ON exclusion_exports (created_at DESC);

ALTER TABLE exclusion_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read exclusion exports" ON exclusion_exports
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Signed-in users can record their own exports" ON exclusion_exports
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

GRANT SELECT, INSERT ON exclusion_exports TO authenticated;

-- Tell the Supabase API to pick up the new table.
NOTIFY pgrst, 'reload schema';
