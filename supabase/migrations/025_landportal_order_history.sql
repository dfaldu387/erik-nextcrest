-- NextCrest migration 025
-- Land Portal order history: one row for each export, skip trace and comp report on the account
-- (the V2 API lists them; it has no separate billing endpoint). Loaded by server/sync/landportal-orders.ts.
-- Only counts, status and dates are kept. Download links and tokens are never stored.
-- Signed-in users can read it. Only the server (service role) writes to it.

BEGIN;

CREATE TABLE IF NOT EXISTS landportal_order_history (
  id TEXT PRIMARY KEY,                       -- "<type>:<source id>", so ids from different types never clash
  order_type TEXT NOT NULL CHECK (order_type IN ('export', 'skip_trace', 'comp_report')),
  status TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  total_rows INT,
  success_rows INT,
  no_match_rows INT,
  test_mode BOOLEAN NOT NULL DEFAULT false,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_landportal_orders_created ON landportal_order_history (created_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_landportal_orders_type ON landportal_order_history (order_type);

ALTER TABLE landportal_order_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY landportal_order_history_read ON landportal_order_history
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT ON landportal_order_history TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
