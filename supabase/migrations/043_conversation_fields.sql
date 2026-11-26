-- NextCrest migration 043
-- The contact form's fields that SmarterContact's API does not expose (bed, bath, roof, follow-up date and so on).
-- One row per conversation, with the values as JSON keyed by field key. The team reads and edits them together.

BEGIN;

CREATE TABLE IF NOT EXISTS conversation_fields (
  contact_id TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE conversation_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation fields readable" ON conversation_fields;
CREATE POLICY "conversation fields readable" ON conversation_fields
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "conversation fields written" ON conversation_fields;
CREATE POLICY "conversation fields written" ON conversation_fields
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "conversation fields updated" ON conversation_fields;
CREATE POLICY "conversation fields updated" ON conversation_fields
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON conversation_fields TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
