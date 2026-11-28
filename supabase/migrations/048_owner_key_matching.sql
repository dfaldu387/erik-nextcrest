-- NextCrest migration 048
-- Owner linking uses owner name AND mailing address (properties.owner_key), not the name alone.
--
-- Why: migration 046 linked every property with the same owner name. That joins one owner's properties correctly, but it
-- also joins different owners who share a common name. The rule agreed with the client is name plus mailing address.
--
-- Unchanged:
--   - Direct links: a phone on one property, or on several properties with the same owner name, still links as before.
--   - Owner keys with more than 20 properties are skipped, so one common owner cannot link a conversation to too many parcels.
--
-- Changed:
--   - Owner expansion matches on owner_key (name + mailing address + city + state + ZIP), not owner_name_key.
--   - Properties with no mailing address have no owner_key and are linked only by a direct phone match.
--
-- Parcels are identified by state, county and APN (see src/lib/duplicates.ts). That is for duplicates, not for owner linking.

BEGIN;

-- Owner keys with more than 20 properties. Same rule as sc_common_owner_names, but on the name + address key.
CREATE OR REPLACE VIEW sc_common_owner_keys AS
SELECT owner_key, count(*) AS properties
FROM properties
WHERE owner_key IS NOT NULL
GROUP BY owner_key
HAVING count(*) > 20;

GRANT SELECT ON sc_common_owner_keys TO authenticated;

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
