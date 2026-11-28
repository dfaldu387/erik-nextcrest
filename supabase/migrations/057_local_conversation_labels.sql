-- NextCrest migration 057
-- Labels edited in NextCrest stay in NextCrest. They are never written to SmarterContact.
--
--   conversation_label_overrides   the labels a team member set for a conversation. The sync (labels batch) uses this
--                                  list instead of SmarterContact's, so an edit is not undone by the next sync.
--   set_conversation_labels_local() saves the override and the conversation's labels in one step. Signed-in users only.
--
-- Labels from SmarterContact are still read by the sync. Only the labels listed here are kept locally.

BEGIN;

CREATE TABLE IF NOT EXISTS conversation_label_overrides (
  contact_id TEXT PRIMARY KEY,
  labels TEXT[] NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE conversation_label_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON conversation_label_overrides FROM anon, authenticated;
GRANT SELECT ON conversation_label_overrides TO authenticated;

DROP POLICY IF EXISTS conversation_label_overrides_read ON conversation_label_overrides;
CREATE POLICY conversation_label_overrides_read ON conversation_label_overrides
  FOR SELECT TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION set_conversation_labels_local(p_contact_id TEXT, p_labels TEXT[])
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_labels TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to NextCrest first.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT btrim(x) ORDER BY btrim(x)), '{}')
  INTO v_labels
  FROM unnest(COALESCE(p_labels, '{}')) AS x
  WHERE btrim(x) <> '';

  IF cardinality(v_labels) > 50 THEN
    RAISE EXCEPTION 'A conversation can have at most 50 labels.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM smartercontact_conversations WHERE contact_id = p_contact_id) THEN
    RAISE EXCEPTION 'Conversation not found.';
  END IF;

  INSERT INTO conversation_label_overrides (contact_id, labels, updated_by, updated_at)
  VALUES (p_contact_id, v_labels, auth.uid(), now())
  ON CONFLICT (contact_id) DO UPDATE
    SET labels = EXCLUDED.labels, updated_by = EXCLUDED.updated_by, updated_at = now();

  UPDATE smartercontact_conversations SET labels = v_labels WHERE contact_id = p_contact_id;

  RETURN v_labels;
END;
$$;

GRANT EXECUTE ON FUNCTION set_conversation_labels_local(TEXT, TEXT[]) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
