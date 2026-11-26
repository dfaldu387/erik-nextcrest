-- NextCrest migration 028
-- Follow-up schedule and the 90-day re-hit rule (docs/BUSINESS_RULES.md).
--
-- app_marketing_status now takes the last contact date, so the status can say when a property is due:
--   rehit_due      90 or more days since the last contact (any contact count), not a responder, not opted out or wrong.
--   followup_due   1 or 2 contacts and 7 or more days since the last contact, not a responder, not opted out or wrong.
-- Constants: 7 quiet days, 3 contacts per cycle, 90 re-hit days. The same rules are in src/lib/followUp.ts.
--
-- search_properties and dashboard_summary call the new version, so the Properties screen, the Command Center and the
-- Follow-Up Queue all see the same status. Everything else in those functions is unchanged from migrations 010 and 018.

BEGIN;

-- The old two-argument version is dropped so the new one is the only app_marketing_status.
DROP FUNCTION IF EXISTS app_marketing_status(TEXT, INT);

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
         AND EXTRACT(EPOCH FROM (p_now - p_last_contacted)) / 86400 >= 90 THEN 'rehit_due'
    WHEN COALESCE(p_marketing, '') <> 'responded'
         AND GREATEST(COALESCE(p_total_contacts, 0), 0) BETWEEN 1 AND 2
         AND p_last_contacted IS NOT NULL
         AND EXTRACT(EPOCH FROM (p_now - p_last_contacted)) / 86400 >= 7 THEN 'followup_due'
    WHEN p_marketing IN ('contacted', 'responded') AND GREATEST(COALESCE(p_total_contacts, 0), 0) = 0 THEN 'contacted_1'
    WHEN GREATEST(COALESCE(p_total_contacts, 0), 0) >= 3 THEN 'contacted_3'
    WHEN GREATEST(COALESCE(p_total_contacts, 0), 0) = 2 THEN 'contacted_2'
    WHEN GREATEST(COALESCE(p_total_contacts, 0), 0) = 1 THEN 'contacted_1'
    ELSE 'never_marketed'
  END
$$;

-- One page of properties, plus the total number of matches in total_count (from migration 018, with the new status).
CREATE OR REPLACE FUNCTION search_properties(
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_county TEXT DEFAULT NULL,
  p_sort TEXT DEFAULT 'owner',
  p_dir TEXT DEFAULT 'asc',
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0,
  p_zips TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  apn TEXT,
  owner_name TEXT,
  owner_type TEXT,
  state TEXT,
  county TEXT,
  zip_code TEXT,
  acres NUMERIC,
  status TEXT,
  marketing_status TEXT,
  total_contacts INT,
  last_contacted_at TIMESTAMPTZ,
  first_acquired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  phone TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
#variable_conflict use_column
DECLARE
  v_pattern TEXT := NULL;
  v_order TEXT;
  v_dir TEXT := CASE WHEN lower(COALESCE(p_dir, '')) = 'desc' THEN 'DESC' ELSE 'ASC' END;
  v_zips TEXT[] := NULL;
BEGIN
  -- Escape LIKE wildcards so the search text is matched literally.
  IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
    v_pattern := '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  -- An empty ZIP list means "no ZIP filter".
  IF p_zips IS NOT NULL AND cardinality(p_zips) > 0 THEN
    v_zips := p_zips;
  END IF;

  -- Only whitelisted expressions reach the ORDER BY clause.
  v_order := CASE COALESCE(p_sort, '')
    WHEN 'apn' THEN 'apn'
    WHEN 'county' THEN '(state || '', '' || COALESCE(county, ''''))'
    WHEN 'acres' THEN 'acres'
    WHEN 'status' THEN 'status'
    WHEN 'times' THEN 'total_contacts'
    WHEN 'last' THEN 'last_contacted_at'
    ELSE 'owner_name'
  END;

  RETURN QUERY EXECUTE format($q$
    WITH base AS (
      SELECT
        p.id,
        COALESCE(p.apn_raw, p.internal_id) AS apn,
        p.owner_name,
        p.owner_type,
        p.state,
        p.county,
        p.zip_code,
        p.acreage AS acres,
        app_marketing_status(p.marketing_status, p.total_contacts, p.last_contacted_at) AS status,
        p.marketing_status,
        GREATEST(COALESCE(p.total_contacts, 0), 0) AS total_contacts,
        p.last_contacted_at,
        p.first_acquired_at,
        p.created_at,
        (
          SELECT ph
          FROM property_owners po
          CROSS JOIN LATERAL unnest(po.phone_numbers) AS ph
          WHERE po.property_id = p.id
          LIMIT 1
        ) AS phone
      FROM properties p
      WHERE ($1::text IS NULL
             OR COALESCE(p.apn_raw, '') ILIKE $1
             OR p.internal_id ILIKE $1
             OR COALESCE(p.owner_name, '') ILIKE $1
             OR COALESCE(p.county, '') ILIKE $1
             OR EXISTS (
               SELECT 1
               FROM property_owners po
               CROSS JOIN LATERAL unnest(po.phone_numbers) AS ph
               WHERE po.property_id = p.id AND ph ILIKE $1
             ))
        AND ($2::text IS NULL OR app_marketing_status(p.marketing_status, p.total_contacts, p.last_contacted_at) = $2)
        AND ($3::text IS NULL OR p.state = $3)
        AND ($4::text IS NULL OR p.county = $4)
        AND ($7::text[] IS NULL OR LEFT(btrim(COALESCE(p.zip_code, '')), 5) = ANY($7::text[]))
    ),
    counted AS (
      SELECT b.*, COUNT(*) OVER () AS total_count
      FROM base b
    )
    SELECT c.id, c.apn, c.owner_name, c.owner_type, c.state, c.county, c.zip_code, c.acres, c.status,
           c.marketing_status, c.total_contacts, c.last_contacted_at, c.first_acquired_at, c.created_at,
           c.phone, c.total_count
    FROM counted c
    ORDER BY %s %s NULLS LAST, c.id
    LIMIT $5 OFFSET $6
  $q$, v_order, v_dir)
  USING v_pattern, p_status, p_state, p_county, GREATEST(COALESCE(p_limit, 25), 1), GREATEST(COALESCE(p_offset, 0), 0), v_zips;
END;
$$;

GRANT EXECUTE ON FUNCTION search_properties(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT[]) TO anon, authenticated;

-- Overview figures (from migration 010, with the new status).
CREATE OR REPLACE FUNCTION dashboard_summary()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH p AS (
    SELECT
      app_marketing_status(marketing_status, total_contacts, last_contacted_at) AS status,
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

COMMIT;

-- Tell the Supabase API (PostgREST) to reload its schema cache.
NOTIFY pgrst, 'reload schema';
