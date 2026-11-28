-- NextCrest migration 049
-- Touches are counted from the SmarterContact message history, across all marketing cycles.
--
-- property_touch_summary: one row per property with its linked conversations.
--   outgoing_touches    messages we sent to the property's owner (automatic campaign texts and texts typed by the team)
--   incoming_replies    messages the seller sent
--   last_outgoing_at    the newest message we sent
--   last_incoming_at    the newest message the seller sent
--
-- It is a view, so it always reflects the synced messages. It runs with the caller's permissions (security_invoker),
-- so row-level security on the messages still applies. It returns counts and dates only, never message text.
--
-- Campaign texts and replies typed by the team are both outgoing. They cannot be told apart from the stored data yet.

BEGIN;

CREATE OR REPLACE VIEW property_touch_summary
WITH (security_invoker = true) AS
SELECT
  l.property_id,
  count(m.message_id) FILTER (WHERE m.direction = 'outgoing') AS outgoing_touches,
  count(m.message_id) FILTER (WHERE m.direction = 'incoming') AS incoming_replies,
  max(m.created_at) FILTER (WHERE m.direction = 'outgoing') AS last_outgoing_at,
  max(m.created_at) FILTER (WHERE m.direction = 'incoming') AS last_incoming_at
FROM sc_conversation_properties l
JOIN smartercontact_messages m ON m.contact_id = l.contact_id
GROUP BY l.property_id;

GRANT SELECT ON property_touch_summary TO authenticated;

COMMIT;
