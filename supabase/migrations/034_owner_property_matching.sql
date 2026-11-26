-- NextCrest migration 034
-- Matches SmarterContact conversations to properties by owner, so one owner's properties share a phone and a status.
--
-- Owner key: owner name + mailing address + state + ZIP (normalised). Two properties with the same key belong to the
-- same owner. A property without a mailing address has no key and is matched on its own.
--
-- Matching rule for a conversation's phone (10 digits):
--   1. Every property that has this phone is found, and each one's owner key is read.
--   2. One owner key only: the conversation links to every property with that owner key (basis 'owner').
--   3. Several owner keys: ambiguous; nothing is linked (no change to any property).
--   4. No owner key and exactly one property: that property (basis 'property').
--   5. Several properties with no owner key: ambiguous; nothing is linked.
--
-- sc_conversation_properties holds the links (many per conversation). smartercontact_conversations.property_id keeps
-- the first linked property for display.

BEGIN;

CREATE OR REPLACE FUNCTION sc_owner_key(p_name TEXT, p_address TEXT, p_city TEXT, p_state TEXT, p_zip TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(btrim(p_name), '') = '' OR coalesce(btrim(p_address), '') = '' THEN NULL
    ELSE upper(regexp_replace(regexp_replace(btrim(p_name), '[^A-Za-z0-9 ]', '', 'g'), '\s+', ' ', 'g'))
      || '|' || upper(regexp_replace(regexp_replace(btrim(p_address), '[^A-Za-z0-9 ]', '', 'g'), '\s+', ' ', 'g'))
      || '|' || upper(btrim(coalesce(p_state, '')))
      || '|' || left(regexp_replace(coalesce(p_zip, ''), '[^0-9]', '', 'g'), 5)
  END
$$;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_key TEXT;

CREATE OR REPLACE FUNCTION sc_set_owner_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.owner_key := sc_owner_key(NEW.owner_name, NEW.mailing_address, NEW.mailing_city, NEW.mailing_state, NEW.mailing_zip);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_properties_owner_key ON properties;
CREATE TRIGGER trg_properties_owner_key
  BEFORE INSERT OR UPDATE OF owner_name, mailing_address, mailing_city, mailing_state, mailing_zip ON properties
  FOR EACH ROW EXECUTE FUNCTION sc_set_owner_key();

UPDATE properties SET owner_key = sc_owner_key(owner_name, mailing_address, mailing_city, mailing_state, mailing_zip);
CREATE INDEX IF NOT EXISTS idx_properties_owner_key ON properties (owner_key);

CREATE TABLE IF NOT EXISTS sc_conversation_properties (
  contact_id TEXT NOT NULL,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  basis TEXT NOT NULL CHECK (basis IN ('owner', 'property')),
  matched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, property_id)
);
CREATE INDEX IF NOT EXISTS idx_sc_conv_props_property ON sc_conversation_properties (property_id);
ALTER TABLE sc_conversation_properties ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY sc_conv_props_read ON sc_conversation_properties FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
GRANT SELECT ON sc_conversation_properties TO authenticated;

-- Recomputes every conversation's links. Returns the number of conversations with at least one link.
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
    SELECT right(regexp_replace(pn.phone_number, '\D', '', 'g'), 10) AS phone10, p.id AS property_id, p.owner_key
    FROM property_phones pp
    JOIN phone_numbers pn ON pn.id = pp.phone_number_id
    JOIN properties p ON p.id = pp.property_id
  ),
  owner_keys AS (
    SELECT DISTINCT phone10, owner_key FROM phone_props WHERE owner_key IS NOT NULL
  ),
  owner_count AS (
    SELECT phone10, count(*) AS n FROM owner_keys GROUP BY phone10
  ),
  owner_match AS (
    SELECT c.contact_id, p.id AS property_id, 'owner'::text AS basis
    FROM conv c
    JOIN owner_count oc ON oc.phone10 = c.phone10 AND oc.n = 1
    JOIN owner_keys ok ON ok.phone10 = c.phone10
    JOIN properties p ON p.owner_key = ok.owner_key
  ),
  prop_count AS (
    SELECT phone10, count(DISTINCT property_id) AS n FROM phone_props GROUP BY phone10
  ),
  property_match AS (
    SELECT c.contact_id, pp.property_id, 'property'::text AS basis
    FROM conv c
    JOIN prop_count pc ON pc.phone10 = c.phone10 AND pc.n = 1
    JOIN phone_props pp ON pp.phone10 = c.phone10
    WHERE NOT EXISTS (SELECT 1 FROM owner_count oc WHERE oc.phone10 = c.phone10)
  ),
  all_matches AS (
    SELECT * FROM owner_match
    UNION
    SELECT * FROM property_match
  )
  INSERT INTO sc_conversation_properties (contact_id, property_id, basis)
  SELECT contact_id, property_id, basis FROM all_matches
  ON CONFLICT (contact_id, property_id) DO NOTHING;

  UPDATE smartercontact_conversations c
  SET property_id = (SELECT min(m.property_id::text)::uuid FROM sc_conversation_properties m WHERE m.contact_id = c.contact_id);

  SELECT count(DISTINCT contact_id)::int INTO matched FROM sc_conversation_properties;
  RETURN matched;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
