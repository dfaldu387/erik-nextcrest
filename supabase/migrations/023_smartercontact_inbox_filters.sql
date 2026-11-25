-- NextCrest migration 023
-- Inbox filters: the choices for the label and area-code pickers.
-- inbox_label_names(): every label name seen on a synced conversation.
-- inbox_area_codes(): every area code (first three digits of the phone) in the inbox.
-- Both read smartercontact_conversations under its row-level security, so only signed-in users see them.

BEGIN;

CREATE OR REPLACE FUNCTION inbox_label_names()
RETURNS SETOF TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT l
  FROM smartercontact_conversations, unnest(labels) AS l
  WHERE l <> ''
  ORDER BY l
$$;

CREATE OR REPLACE FUNCTION inbox_area_codes()
RETURNS SETOF TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT left(phone, 3)
  FROM smartercontact_conversations
  WHERE phone IS NOT NULL
  ORDER BY 1
$$;

GRANT EXECUTE ON FUNCTION inbox_label_names() TO authenticated;
GRANT EXECUTE ON FUNCTION inbox_area_codes() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
