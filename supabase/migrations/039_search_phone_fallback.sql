-- NextCrest migration 039
-- The property search shows a phone number even when the property has no owner record: the first linked phone
-- (property_phones) is used when the owner has none. Everything else is unchanged from migration 028.

BEGIN;

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
        COALESCE(
          (
            SELECT ph
            FROM property_owners po
            CROSS JOIN LATERAL unnest(po.phone_numbers) AS ph
            WHERE po.property_id = p.id
            LIMIT 1
          ),
          (
            SELECT pn.phone_number
            FROM property_phones pp
            JOIN phone_numbers pn ON pn.id = pp.phone_number_id
            WHERE pp.property_id = p.id
            ORDER BY pp.position NULLS LAST, pn.phone_number
            LIMIT 1
          )
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

COMMIT;

NOTIFY pgrst, 'reload schema';
