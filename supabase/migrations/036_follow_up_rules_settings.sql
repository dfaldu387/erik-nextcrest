-- NextCrest migration 036
-- The follow-up rules move out of the code into one settings row that admins can change:
--   quiet_days   days after a contact before a follow-up is due (default 7)
--   max_contacts contacts per cycle; at this count the property waits for the re-hit (default 3)
--   rehit_days   days after the last contact before a re-hit is due (default 90)
-- app_marketing_status reads the row, so the Properties screen, the dashboard and the queue all use the same rules.

BEGIN;

CREATE TABLE IF NOT EXISTS sc_follow_up_rules (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  quiet_days INT NOT NULL DEFAULT 7 CHECK (quiet_days BETWEEN 0 AND 365),
  max_contacts INT NOT NULL DEFAULT 3 CHECK (max_contacts BETWEEN 1 AND 20),
  rehit_days INT NOT NULL DEFAULT 90 CHECK (rehit_days BETWEEN 1 AND 730),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);
INSERT INTO sc_follow_up_rules (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE sc_follow_up_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY sc_follow_up_rules_read ON sc_follow_up_rules FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY sc_follow_up_rules_admin_write ON sc_follow_up_rules FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
GRANT SELECT, UPDATE ON sc_follow_up_rules TO authenticated;

-- Marketing status shown in the app. Must match followUpDue() in src/lib/followUp.ts (the rules come from the row above).
CREATE OR REPLACE FUNCTION app_marketing_status(
  p_marketing TEXT,
  p_total_contacts INT,
  p_last_contacted TIMESTAMPTZ DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_marketing = 'opted_out' THEN 'opted_out'
    WHEN p_marketing = 'wrong_number' THEN 'wrong_number'
    WHEN p_marketing = 'follow_up_due' THEN 'followup_due'
    WHEN COALESCE(p_marketing, '') <> 'responded'
         AND GREATEST(COALESCE(p_total_contacts, 0), 0) > 0
         AND p_last_contacted IS NOT NULL
         AND EXTRACT(EPOCH FROM (p_now - p_last_contacted)) / 86400 >= (SELECT rehit_days FROM sc_follow_up_rules WHERE id = 1) THEN 'rehit_due'
    WHEN COALESCE(p_marketing, '') <> 'responded'
         AND GREATEST(COALESCE(p_total_contacts, 0), 0) BETWEEN 1 AND (SELECT max_contacts FROM sc_follow_up_rules WHERE id = 1) - 1
         AND p_last_contacted IS NOT NULL
         AND EXTRACT(EPOCH FROM (p_now - p_last_contacted)) / 86400 >= (SELECT quiet_days FROM sc_follow_up_rules WHERE id = 1) THEN 'followup_due'
    WHEN p_marketing IN ('contacted', 'responded') AND GREATEST(COALESCE(p_total_contacts, 0), 0) = 0 THEN 'contacted_1'
    WHEN GREATEST(COALESCE(p_total_contacts, 0), 0) >= 3 THEN 'contacted_3'
    WHEN GREATEST(COALESCE(p_total_contacts, 0), 0) = 2 THEN 'contacted_2'
    WHEN GREATEST(COALESCE(p_total_contacts, 0), 0) = 1 THEN 'contacted_1'
    ELSE 'never_marketed'
  END
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
