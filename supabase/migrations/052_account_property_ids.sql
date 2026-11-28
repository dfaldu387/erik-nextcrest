-- NextCrest migration 052
-- The property ids linked to one SmarterContact account's conversations. Pages that load every record use this to
-- show only that account's records. Same rule as search_properties (migration 050).
-- Runs as SECURITY INVOKER, so row-level security still applies.

BEGIN;

CREATE OR REPLACE FUNCTION account_property_ids(p_account_id TEXT)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT l.property_id
  FROM sc_conversation_properties l
  JOIN smartercontact_conversations c ON c.contact_id = l.contact_id
  WHERE c.account_id = p_account_id
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION account_property_ids(TEXT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
