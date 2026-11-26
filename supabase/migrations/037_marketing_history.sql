-- NextCrest migration 037
-- Outbound marketing history, so "never marketed" can be told apart from "previously marketed".
--
--   smartercontact_conversations.messages_synced_at  when a conversation's messages were read in full (the last 50).
--                                                    The sync reads every conversation once, so outbound texts that
--                                                    were sent before are captured too.
--   sc_marketing_split()                             counts properties as never marketed (no outbound text in any
--                                                    linked conversation and no campaign contact) or previously
--                                                    marketed. It also reports how many conversations have been read.

BEGIN;

ALTER TABLE smartercontact_conversations ADD COLUMN IF NOT EXISTS messages_synced_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_sc_conversations_messages_synced ON smartercontact_conversations (messages_synced_at NULLS FIRST);

CREATE OR REPLACE FUNCTION sc_marketing_split()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH outbound AS (
    SELECT DISTINCT l.property_id
    FROM sc_conversation_properties l
    JOIN smartercontact_messages m ON m.contact_id = l.contact_id
    WHERE m.direction = 'outgoing'
  ),
  props AS (
    SELECT p.id, coalesce(p.total_contacts, 0) AS contacts, (o.property_id IS NOT NULL) AS has_outbound
    FROM properties p
    LEFT JOIN outbound o ON o.property_id = p.id
  )
  SELECT jsonb_build_object(
    'never_marketed', (SELECT count(*) FROM props WHERE NOT has_outbound AND contacts = 0),
    'previously_marketed', (SELECT count(*) FROM props WHERE has_outbound OR contacts > 0),
    'conversations_read_in_full', (SELECT count(*) FROM smartercontact_conversations WHERE messages_synced_at IS NOT NULL),
    'conversations_total', (SELECT count(*) FROM smartercontact_conversations)
  )
$$;

GRANT EXECUTE ON FUNCTION sc_marketing_split() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
