-- 010_dashboard_summary.sql
-- Overview figures calculated in the database, so the dashboard does not download every property first.
-- The status rules match toMarketingStatus() in src/lib/propertyRecords.ts (via app_marketing_status, migration 007).
--
-- Runs as SECURITY INVOKER, so row-level security still decides which rows are counted.

CREATE OR REPLACE FUNCTION dashboard_summary()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH p AS (
    SELECT
      app_marketing_status(marketing_status, total_contacts) AS status,
      GREATEST(COALESCE(total_contacts, 0), 0) AS contacts,
      (marketing_status = 'responded') AS responded
    FROM properties
  )
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM p),
    'never_marketed', (SELECT COUNT(*) FROM p WHERE status = 'never_marketed'),
    'contacted', (SELECT COUNT(*) FROM p WHERE status LIKE 'contacted%'),
    'followup_due', (SELECT COUNT(*) FROM p WHERE status = 'followup_due'),
    'rehit_due', (SELECT COUNT(*) FROM p WHERE status = 'rehit_due'),
    'wrong_number', (SELECT COUNT(*) FROM p WHERE status = 'wrong_number'),
    'opted_out', (SELECT COUNT(*) FROM p WHERE status = 'opted_out'),
    'responded', (SELECT COUNT(*) FROM p WHERE responded),
    'reached_1', (SELECT COUNT(*) FROM p WHERE contacts >= 1),
    'reached_2', (SELECT COUNT(*) FROM p WHERE contacts >= 2),
    'reached_3', (SELECT COUNT(*) FROM p WHERE contacts >= 3),
    'counties', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object('state', c.state, 'county', c.county, 'records', c.records, 'texted', c.texted)
          ORDER BY c.state, c.county
        )
        FROM (
          SELECT
            state,
            COALESCE(county, '') AS county,
            COUNT(*) AS records,
            COUNT(*) FILTER (WHERE COALESCE(total_contacts, 0) > 0) AS texted
          FROM properties
          GROUP BY state, COALESCE(county, '')
        ) c
      ),
      '[]'::jsonb
    )
  );
$$;

GRANT EXECUTE ON FUNCTION dashboard_summary() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
