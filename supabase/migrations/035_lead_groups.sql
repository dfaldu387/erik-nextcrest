-- NextCrest migration 035
-- Splits properties into lead groups from the SmarterContact labels of their linked conversations
-- (sc_conversation_properties, migration 034). Each property is counted once, in the first group that applies:
--
--   excluded          a response that rules the property out of marketing (labels listed in sc_lead_label_rules)
--   scheduled_followup a seller who asked to be contacted later (follow-up labels)
--   nurture           a positive response that needs comping (label "Nuture")
--
-- The API does not return follow-up dates (they are custom fields), so the scheduled group uses the labels only.
-- The label lists are a starting point; the client confirms them.

BEGIN;

CREATE TABLE IF NOT EXISTS sc_lead_label_rules (
  group_key TEXT NOT NULL CHECK (group_key IN ('excluded', 'scheduled_followup', 'nurture')),
  label TEXT NOT NULL,
  PRIMARY KEY (group_key, label)
);
ALTER TABLE sc_lead_label_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY sc_lead_label_rules_read ON sc_lead_label_rules FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
GRANT SELECT ON sc_lead_label_rules TO authenticated;

INSERT INTO sc_lead_label_rules (group_key, label) VALUES
  ('excluded', 'NI'),
  ('excluded', 'Not interested'),
  ('excluded', 'DQ'),
  ('excluded', 'Home-DQ'),
  ('excluded', 'Wrong Number'),
  ('excluded', 'WN'),
  ('scheduled_followup', 'FU'),
  ('scheduled_followup', 'FU-LT'),
  ('scheduled_followup', 'FU-Offer'),
  ('scheduled_followup', 'Lead-FU'),
  ('nurture', 'Nuture')
ON CONFLICT DO NOTHING;

-- Counts of properties per group, each property counted once.
CREATE OR REPLACE FUNCTION sc_lead_groups()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH linked AS (
    SELECT l.property_id, c.labels
    FROM sc_conversation_properties l
    JOIN smartercontact_conversations c ON c.contact_id = l.contact_id
  ),
  per_property AS (
    SELECT
      property_id,
      bool_or(EXISTS (SELECT 1 FROM sc_lead_label_rules r WHERE r.group_key = 'excluded' AND r.label = ANY(linked.labels))) AS is_excluded,
      bool_or(EXISTS (SELECT 1 FROM sc_lead_label_rules r WHERE r.group_key = 'scheduled_followup' AND r.label = ANY(linked.labels))) AS is_scheduled,
      bool_or(EXISTS (SELECT 1 FROM sc_lead_label_rules r WHERE r.group_key = 'nurture' AND r.label = ANY(linked.labels))) AS is_nurture
    FROM linked
    GROUP BY property_id
  ),
  grouped AS (
    SELECT
      CASE
        WHEN is_excluded THEN 'excluded'
        WHEN is_scheduled THEN 'scheduled_followup'
        WHEN is_nurture THEN 'nurture'
        ELSE 'other'
      END AS grp
    FROM per_property
  )
  SELECT jsonb_build_object(
    'excluded', (SELECT count(*) FROM grouped WHERE grp = 'excluded'),
    'scheduled_followup', (SELECT count(*) FROM grouped WHERE grp = 'scheduled_followup'),
    'nurture', (SELECT count(*) FROM grouped WHERE grp = 'nurture'),
    'linked_properties', (SELECT count(*) FROM grouped),
    'follow_up_dates_available', false
  )
$$;

GRANT EXECUTE ON FUNCTION sc_lead_groups() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
