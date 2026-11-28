-- NextCrest migration 055
-- Faster marketing history on the Overview. sc_marketing_split used to run its counts as separate subqueries, which
-- scanned the properties and conversations tables several times (about 3 s). This version does the outbound check
-- once, and reads properties and conversations in one pass each (about 0.2 s). The results are the same.

BEGIN;

CREATE OR REPLACE FUNCTION sc_marketing_split()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  WITH outbound AS (
    SELECT DISTINCT l.property_id
    FROM sc_conversation_properties l
    WHERE EXISTS (
      SELECT 1 FROM smartercontact_messages m
      WHERE m.contact_id = l.contact_id AND m.direction = 'outgoing'
    )
  ),
  props AS (
    SELECT
      count(*) FILTER (WHERE coalesce(p.total_contacts, 0) = 0 AND o.property_id IS NULL) AS never_marketed,
      count(*) FILTER (WHERE coalesce(p.total_contacts, 0) > 0 OR o.property_id IS NOT NULL) AS previously_marketed
    FROM properties p
    LEFT JOIN outbound o ON o.property_id = p.id
  ),
  conv AS (
    SELECT
      count(*) FILTER (WHERE messages_synced_at IS NOT NULL) AS read_in_full,
      count(*) AS total
    FROM smartercontact_conversations
  )
  SELECT jsonb_build_object(
    'never_marketed', props.never_marketed,
    'previously_marketed', props.previously_marketed,
    'conversations_read_in_full', conv.read_in_full,
    'conversations_total', conv.total
  )
  FROM props, conv
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
