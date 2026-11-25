-- 007_properties_search.sql
-- Server-side search, filtering, sorting and paging for the Properties screen.
-- The screen used to download every property (sequential 1,000-row requests) and filter in the
-- browser. These functions do the work in the database so the page loads one page of rows at a time.
--
-- Both functions run as SECURITY INVOKER (the default), so row-level security still decides what
-- each signed-in user can see.

-- Marketing status shown in the app. Must match toMarketingStatus() in src/lib/propertyRecords.ts.
CREATE OR REPLACE FUNCTION app_marketing_status(p_marketing TEXT, p_total_contacts INT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_marketing = 'opted_out' THEN 'opted_out'
    WHEN p_marketing = 'wrong_number' THEN 'wrong_number'
    WHEN p_marketing = 'follow_up_due' THEN 'followup_due'
    WHEN p_marketing IN ('contacted', 'responded') AND GREATEST(COALESCE(p_total_contacts, 0), 0) = 0 THEN 'contacted_1'
    WHEN GREATEST(COALESCE(p_total_contacts, 0), 0) >= 3 THEN 'contacted_3'
    WHEN GREATEST(COALESCE(p_total_contacts, 0), 0) = 2 THEN 'contacted_2'
    WHEN GREATEST(COALESCE(p_total_contacts, 0), 0) = 1 THEN 'contacted_1'
    ELSE 'never_marketed'
  END
$$;

-- One page of properties, plus the total number of matches in total_count.
-- p_sort: apn | owner | county | acres | status | times | last
-- p_dir:  asc | desc
CREATE OR REPLACE FUNCTION search_properties(
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_county TEXT DEFAULT NULL,
  p_sort TEXT DEFAULT 'owner',
  p_dir TEXT DEFAULT 'asc',
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
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
BEGIN
  -- Escape LIKE wildcards so the search text is matched literally.
  IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
    v_pattern := '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
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
        app_marketing_status(p.marketing_status, p.total_contacts) AS status,
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
        AND ($2::text IS NULL OR app_marketing_status(p.marketing_status, p.total_contacts) = $2)
        AND ($3::text IS NULL OR p.state = $3)
        AND ($4::text IS NULL OR p.county = $4)
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
  USING v_pattern, p_status, p_state, p_county, GREATEST(COALESCE(p_limit, 25), 1), GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

-- Total property count and the distinct state/county pairs, for the filter dropdowns.
CREATE OR REPLACE FUNCTION property_filter_options()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM properties),
    'places', COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('state', d.state, 'county', d.county) ORDER BY d.state, d.county)
        FROM (SELECT DISTINCT state, county FROM properties WHERE county IS NOT NULL AND county <> '') d
      ),
      '[]'::jsonb
    )
  );
$$;

GRANT EXECUTE ON FUNCTION app_marketing_status(TEXT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION search_properties(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION property_filter_options() TO anon, authenticated;

-- Tell the Supabase API (PostgREST) to reload its schema cache so the new functions are callable.
NOTIFY pgrst, 'reload schema';
