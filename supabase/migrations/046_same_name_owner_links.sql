-- NextCrest migration 046
-- Same owner name, several properties. The owner key (name + mailing address) splits one owner who receives mail at
-- two addresses. The owner expansion now matches on the owner name only. A name on more than 20 properties is skipped,
-- because a common name would link a conversation to too many parcels. Those names are listed in
-- sc_common_owner_names for review.

BEGIN;

CREATE OR REPLACE VIEW sc_common_owner_names AS
SELECT owner_name_key, count(*) AS properties
FROM properties
WHERE owner_name_key IS NOT NULL
GROUP BY owner_name_key
HAVING count(*) > 20;

GRANT SELECT ON sc_common_owner_names TO authenticated;

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

  WITH owner_names AS (
    SELECT DISTINCT l.contact_id, p.owner_name_key
    FROM sc_conversation_properties l
    JOIN properties p ON p.id = l.property_id
    WHERE p.owner_name_key IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sc_common_owner_names cn WHERE cn.owner_name_key = p.owner_name_key)
  )
  INSERT INTO sc_conversation_properties (contact_id, property_id, basis)
  SELECT ow.contact_id, p.id, 'owner'
  FROM owner_names ow
  JOIN properties p ON p.owner_name_key = ow.owner_name_key
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
