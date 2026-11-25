-- 009_import_batches.sql
-- Import history. Every purchase file saved to the database gets one batch row with its counts,
-- and every property it created points back to that batch, so an import can always be traced.

CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL DEFAULT auth.uid(),
  filename TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'land_portal',
  purchase_date DATE NOT NULL,
  total_rows INT NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  new_rows INT NOT NULL DEFAULT 0 CHECK (new_rows >= 0),
  existing_rows INT NOT NULL DEFAULT 0 CHECK (existing_rows >= 0),
  duplicate_rows INT NOT NULL DEFAULT 0 CHECK (duplicate_rows >= 0),
  invalid_rows INT NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
  missing_apn_rows INT NOT NULL DEFAULT 0 CHECK (missing_apn_rows >= 0),
  committed_rows INT NOT NULL DEFAULT 0 CHECK (committed_rows >= 0),
  failed_rows INT NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'completed_with_errors', 'failed')),
  error_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_import_batches_created_at ON import_batches (created_at DESC);

-- Link each property to the batch that created it. Nullable: properties imported before this migration have no batch.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id);
CREATE INDEX IF NOT EXISTS idx_properties_import_batch_id ON properties (import_batch_id);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read import batches" ON import_batches
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Signed-in users can start their own import batches" ON import_batches
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Only the batch's creator can update its status and counts while it runs. Batches are never deleted from the app.
CREATE POLICY "Creators can update their own import batches" ON import_batches
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

GRANT SELECT, INSERT, UPDATE ON import_batches TO authenticated;

-- Tell the Supabase API to pick up the new table and column.
NOTIFY pgrst, 'reload schema';
