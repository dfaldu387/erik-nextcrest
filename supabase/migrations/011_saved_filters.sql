-- 011_saved_filters.sql
-- Saved filter sets for the Search & Buy page. Every signed-in user can see and use the team's filters.
-- Only the person who saved a filter can rename it or delete it.

CREATE TABLE IF NOT EXISTS saved_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL DEFAULT auth.uid(),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  criteria JSONB NOT NULL CHECK (jsonb_typeof(criteria) = 'object')
);

-- One filter per name, ignoring case and spacing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_filters_name ON saved_filters (lower(btrim(name)));

ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read saved filters" ON saved_filters
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Signed-in users can save filters as themselves" ON saved_filters
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Creators can rename their own filters" ON saved_filters
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Creators can delete their own filters" ON saved_filters
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON saved_filters TO authenticated;

-- Tell the Supabase API to pick up the new table.
NOTIFY pgrst, 'reload schema';
