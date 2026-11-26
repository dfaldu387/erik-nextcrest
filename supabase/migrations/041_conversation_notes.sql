-- NextCrest migration 041
-- Notes on a SmarterContact conversation, kept in NextCrest. The SmarterContact API has no notes endpoint, so notes
-- written here stay in NextCrest and are not sent back to SmarterContact.

BEGIN;

CREATE TABLE IF NOT EXISTS conversation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  author_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_notes_contact ON conversation_notes (contact_id, created_at DESC);

ALTER TABLE conversation_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation notes readable" ON conversation_notes;
CREATE POLICY "conversation notes readable" ON conversation_notes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "conversation notes added by the author" ON conversation_notes;
CREATE POLICY "conversation notes added by the author" ON conversation_notes
  FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());

GRANT SELECT, INSERT ON conversation_notes TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
