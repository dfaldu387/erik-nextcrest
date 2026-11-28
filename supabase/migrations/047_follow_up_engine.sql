-- NextCrest migration 047
-- Follow-up engine, first version:
--   property_follow_ups  one scheduled follow-up date per property (the "Follow Up On" date).
--                        A row is due when follow_up_on is today or earlier, and upcoming when it is within 7 days.
--                        Marking a follow-up done deletes the row.
--   app_alerts           warnings the dashboard shows until someone resolves them. One open alert per kind.
--                        First use: the opt-out list could not be refreshed before an export.

BEGIN;

CREATE TABLE IF NOT EXISTS property_follow_ups (
  property_id UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  follow_up_on DATE NOT NULL,
  note TEXT,
  set_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  set_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_follow_ups_on ON property_follow_ups (follow_up_on);

ALTER TABLE property_follow_ups ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY property_follow_ups_read ON property_follow_ups FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY property_follow_ups_write ON property_follow_ups FOR ALL TO authenticated
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON property_follow_ups TO authenticated;

CREATE TABLE IF NOT EXISTS app_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  resolved_at TIMESTAMP WITH TIME ZONE
);

-- At most one open alert of each kind.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_alerts_open_kind ON app_alerts (kind) WHERE resolved_at IS NULL;

ALTER TABLE app_alerts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_alerts_read ON app_alerts FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY app_alerts_write ON app_alerts FOR ALL TO authenticated
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE ON app_alerts TO authenticated;

COMMIT;
