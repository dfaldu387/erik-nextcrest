-- NextCrest migration 044
-- Same owner, several properties. A phone number can belong to several properties of one owner, and the owner key
-- (name + mailing address) misses some of them: a property without a mailing address has no key, and a name written
-- differently gives a different key. Rules now:
--   1. A phone on one property links the conversation to that property.
--   2. A phone on several properties whose owner names agree (ignoring case, punctuation and word order) links the
--      conversation to all of them.
--   3. A phone on several properties with different owner names links nothing. It is listed in
--      sc_shared_phone_review for a person to decide.
--   4. A matched property's owner key also links the owner's other properties (same name and mailing address).

BEGIN;

CREATE OR REPLACE FUNCTION sc_owner_name_key(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(string_agg(t, ' ' ORDER BY t), '')
  FROM (
    SELECT DISTINCT regexp_split_to_table(upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9 ]', ' ', 'g')), '\s+') AS t
  ) s
  WHERE t <> ''
$$;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_name_key TEXT;

CREATE OR REPLACE FUNCTION sc_set_owner_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.owner_name_key := sc_owner_name_key(NEW.owner_name);
  NEW.owner_key := sc_owner_key(NEW.owner_name, NEW.mailing_address, NEW.mailing_city, NEW.mailing_state, NEW.mailing_zip);
  RETURN NEW;
END;
$$;

UPDATE properties SET owner_name_key = sc_owner_name_key(owner_name);
CREATE INDEX IF NOT EXISTS idx_properties_owner_name_key ON properties (owner_name_key);

CREATE OR REPLACE VIEW sc_shared_phone_review AS
WITH phone_props AS (
  SELECT right(regexp_replace(pn.phone_number, '\D', '', 'g'), 10) AS phone10, p.id AS property_id, p.owner_name_key
  FROM property_phones pp
  JOIN phone_numbers pn ON pn.id = pp.phone_number_id
  JOIN properties p ON p.id = pp.property_id
),
stats AS (
  SELECT phone10, count(DISTINCT property_id) AS props, count(DISTINCT owner_name_key) AS names
  FROM phone_props
  GROUP BY phone10
)
SELECT c.contact_id, c.phone, s.props AS properties, s.names AS owner_names
FROM smartercontact_conversations c
JOIN stats s ON s.phone10 = right(regexp_replace(c.phone, '\D', '', 'g'), 10)
WHERE s.names > 1;

GRANT SELECT ON sc_shared_phone_review TO authenticated;

CREATE OR REPLACE FUNCTION sc_match_conversations()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  matched INT;
BEGIN
  DELETE FROM sc_conversation_properties;

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

  WITH owner_keys AS (
    SELECT DISTINCT l.contact_id, p.owner_key
    FROM sc_conversation_properties l
    JOIN properties p ON p.id = l.property_id
    WHERE p.owner_key IS NOT NULL
  )
  INSERT INTO sc_conversation_properties (contact_id, property_id, basis)
  SELECT ok.contact_id, p.id, 'owner'
  FROM owner_keys ok
  JOIN properties p ON p.owner_key = ok.owner_key
  ON CONFLICT (contact_id, property_id) DO NOTHING;

  UPDATE smartercontact_conversations c
  SET property_id = (SELECT min(m.property_id::text)::uuid FROM sc_conversation_properties m WHERE m.contact_id = c.contact_id);

  SELECT count(DISTINCT contact_id)::int INTO matched FROM sc_conversation_properties;
  RETURN matched;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
