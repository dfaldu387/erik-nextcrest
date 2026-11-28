-- NextCrest migration 058
-- Match SmarterContact conversations to imported properties by APN, county and state.
--
--   conversation_parcels        the APN, parcel county and parcel state SmarterContact holds for a conversation's contact
--                               (its custom fields). Filled in the background by the sync (parcels batch). A row is
--                               written even when a value is empty, so each conversation is read once.
--   sc_parcel_backlog()         conversations of one account that have no parcel row yet (used by the sync).
--   sc_conversation_properties  the basis column now also allows 'same_owner_phone' (already written by the matcher,
--                               but rejected by the live constraint) and 'apn'.
--   sc_match_conversations()    adds the APN match. Same rules as migration 048 otherwise.

BEGIN;

ALTER TABLE sc_conversation_properties DROP CONSTRAINT IF EXISTS sc_conversation_properties_basis_check;
ALTER TABLE sc_conversation_properties
  ADD CONSTRAINT sc_conversation_properties_basis_check
  CHECK (basis IN ('owner', 'property', 'same_owner_phone', 'apn'));

CREATE TABLE IF NOT EXISTS conversation_parcels (
  contact_id TEXT PRIMARY KEY,
  apn TEXT,
  county TEXT,
  state TEXT,
  fields_synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE conversation_parcels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON conversation_parcels FROM anon, authenticated;
GRANT SELECT ON conversation_parcels TO authenticated;

DROP POLICY IF EXISTS conversation_parcels_read ON conversation_parcels;
CREATE POLICY conversation_parcels_read ON conversation_parcels
  FOR SELECT TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION sc_parcel_backlog(p_account_id TEXT, p_limit INT)
RETURNS TABLE (contact_id TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT c.contact_id
  FROM smartercontact_conversations c
  WHERE c.account_id = p_account_id
    AND NOT EXISTS (SELECT 1 FROM conversation_parcels cp WHERE cp.contact_id = c.contact_id)
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION sc_parcel_backlog(TEXT, INT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION sc_match_conversations()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  matched INT;
BEGIN
  DELETE FROM sc_conversation_properties WHERE contact_id IS NOT NULL;

  WITH conv AS (
    SELECT c.contact_id, right(regexp_replace(c.phone, '\D', '', 'g'), 10) AS phone10
    FROM smartercontact_conversations c
    WHERE c.phone IS NOT NULL AND c.phone <> ''
  ),
  phone_props AS (
    SELECT right(regexp_replace(pn.phone_number, '\D', '', 'g'), 10) AS phone10, p.id AS property_id, p.owner_name_key
    FROM property_phones pp
    JOIN phone_numbers pn ON pn.id = pp.phone_number_id
    JOIN properties p ON p.id = pp.property_id
  ),
  stats AS (
    SELECT phone10, count(DISTINCT property_id) AS props, count(DISTINCT owner_name_key) AS names
    FROM phone_props
    GROUP BY phone10
  ),
  direct AS (
    SELECT c.contact_id, pp.property_id, CASE WHEN s.props = 1 THEN 'property' ELSE 'same_owner_phone' END AS basis
    FROM conv c
    JOIN stats s ON s.phone10 = c.phone10 AND s.names <= 1
    JOIN phone_props pp ON pp.phone10 = c.phone10
  )
  INSERT INTO sc_conversation_properties (contact_id, property_id, basis)
  SELECT contact_id, property_id, basis FROM direct
  ON CONFLICT (contact_id, property_id) DO NOTHING;

  -- APN match: the contact's parcel (APN, county, state) against the property's APN, county and state.
  INSERT INTO sc_conversation_properties (contact_id, property_id, basis)
  SELECT DISTINCT cp.contact_id, p.id, 'apn'
  FROM conversation_parcels cp
  JOIN properties p
    ON upper(p.state) = upper(cp.state)
   AND lower(p.county) = lower(cp.county)
   AND smartercontact_norm_apn(p.apn_raw) = smartercontact_norm_apn(cp.apn)
  WHERE cp.apn IS NOT NULL
    AND smartercontact_norm_apn(cp.apn) <> ''
    AND cp.state IS NOT NULL AND cp.county IS NOT NULL
  ON CONFLICT (contact_id, property_id) DO NOTHING;

  -- Owner expansion: other properties with the same owner name AND mailing address as a directly linked property.
  WITH owner_keys AS (
    SELECT DISTINCT l.contact_id, p.owner_key
    FROM sc_conversation_properties l
    JOIN properties p ON p.id = l.property_id
    WHERE p.owner_key IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sc_common_owner_keys ck WHERE ck.owner_key = p.owner_key)
  )
  INSERT INTO sc_conversation_properties (contact_id, property_id, basis)
  SELECT ok.contact_id, p.id, 'owner'
  FROM owner_keys ok
  JOIN properties p ON p.owner_key = ok.owner_key
  ON CONFLICT (contact_id, property_id) DO NOTHING;

  UPDATE smartercontact_conversations c
  SET property_id = (SELECT min(m.property_id::text)::uuid FROM sc_conversation_properties m WHERE m.contact_id = c.contact_id)
  WHERE c.contact_id IS NOT NULL;

  SELECT count(DISTINCT contact_id)::int INTO matched FROM sc_conversation_properties;
  RETURN matched;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
