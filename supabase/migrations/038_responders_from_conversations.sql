-- NextCrest migration 038
-- A property that has replied is a responder. Until now only the campaign import set "responded", so the Responders
-- page and the Responded card stayed at zero while the lead groups counted the same people.
--
-- sc_mark_responders() marks a property "responded" when a linked conversation:
--   - has an incoming message (the owner wrote back), or
--   - carries a lead label (Nuture, a follow-up label, or an excluded label such as Not interested).
-- Opted-out and wrong-number properties keep their status. The mark is only added here; it is not cleared.

BEGIN;

CREATE OR REPLACE FUNCTION sc_mark_responders()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  changed INT;
BEGIN
  WITH responders AS (
    SELECT DISTINCT l.property_id
    FROM sc_conversation_properties l
    JOIN smartercontact_conversations c ON c.contact_id = l.contact_id
    WHERE EXISTS (SELECT 1 FROM smartercontact_messages m WHERE m.contact_id = c.contact_id AND m.direction = 'incoming')
       OR EXISTS (SELECT 1 FROM sc_lead_label_rules r WHERE r.label = ANY(c.labels))
  )
  UPDATE properties p
  SET marketing_status = 'responded', updated_at = now()
  WHERE p.id IN (SELECT property_id FROM responders)
    AND coalesce(p.marketing_status, '') NOT IN ('responded', 'opted_out', 'wrong_number');
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
