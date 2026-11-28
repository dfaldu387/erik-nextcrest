-- NextCrest migration 056
-- Faster property lists (Properties, Overview follow-ups and recent contacts, Follow-ups, Responders).
--
-- Three changes to search_properties (migrations 039 and 050). The results are the same:
--   1. The marketing status is worked out once per property, from the follow-up rules read once per query. The old
--      version called app_marketing_status() several times per property, and each call read the rules table again.
--      The rules here must match app_marketing_status() (migration 036); see the parity check in the commit notes.
--   2. The phone number lookup runs only for the rows on the page, not for every property.
--   3. Parameters, the account filter (p_account_id, migration 050) and the result columns are unchanged.

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
  p_zips TEXT[] DEFAULT NULL,
  p_account_id TEXT DEFAULT NULL
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
  v_account TEXT := NULLIF(btrim(COALESCE(p_account_id, '')), '');
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
    WITH rules AS (
      SELECT rehit_days, quiet_days, max_contacts FROM sc_follow_up_rules WHERE id = 1
    ),
    base AS (
      SELECT
        p.id,
        COALESCE(p.apn_raw, p.internal_id) AS apn,
        p.owner_name,
        p.owner_type,
        p.state,
        p.county,
        p.zip_code,
        p.acreage AS acres,
        st.status,
        p.marketing_status,
        GREATEST(COALESCE(p.total_contacts, 0), 0) AS total_contacts,
        p.last_contacted_at,
        p.first_acquired_at,
        p.created_at
      FROM properties p
      CROSS JOIN rules r
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN p.marketing_status = 'opted_out' THEN 'opted_out'
          WHEN p.marketing_status = 'wrong_number' THEN 'wrong_number'
          WHEN p.marketing_status = 'follow_up_due' THEN 'followup_due'
          WHEN COALESCE(p.marketing_status, '') <> 'responded'
               AND GREATEST(COALESCE(p.total_contacts, 0), 0) > 0
               AND p.last_contacted_at IS NOT NULL
               AND EXTRACT(EPOCH FROM (now() - p.last_contacted_at)) / 86400 >= r.rehit_days THEN 'rehit_due'
          WHEN COALESCE(p.marketing_status, '') <> 'responded'
               AND GREATEST(COALESCE(p.total_contacts, 0), 0) BETWEEN 1 AND r.max_contacts - 1
               AND p.last_contacted_at IS NOT NULL
               AND EXTRACT(EPOCH FROM (now() - p.last_contacted_at)) / 86400 >= r.quiet_days THEN 'followup_due'
          WHEN p.marketing_status IN ('contacted', 'responded') AND GREATEST(COALESCE(p.total_contacts, 0), 0) = 0 THEN 'contacted_1'
          WHEN GREATEST(COALESCE(p.total_contacts, 0), 0) >= 3 THEN 'contacted_3'
          WHEN GREATEST(COALESCE(p.total_contacts, 0), 0) = 2 THEN 'contacted_2'
          WHEN GREATEST(COALESCE(p.total_contacts, 0), 0) = 1 THEN 'contacted_1'
          ELSE 'never_marketed'
        END AS status
      ) st
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
        AND ($2::text IS NULL OR st.status = $2)
        AND ($3::text IS NULL OR p.state = $3)
        AND ($4::text IS NULL OR p.county = $4)
        AND ($7::text[] IS NULL OR LEFT(btrim(COALESCE(p.zip_code, '')), 5) = ANY($7::text[]))
        AND ($8::text IS NULL OR EXISTS (
              SELECT 1
              FROM sc_conversation_properties l
              JOIN smartercontact_conversations c ON c.contact_id = l.contact_id
              WHERE l.property_id = p.id AND c.account_id = $8
            ))
    ),
    counted AS (
      SELECT b.*, COUNT(*) OVER () AS total_count
      FROM base b
    ),
    page AS (
      SELECT c.*
      FROM counted c
      ORDER BY %s %s NULLS LAST, c.id
      LIMIT $5 OFFSET $6
    )
    SELECT pg.id, pg.apn, pg.owner_name, pg.owner_type, pg.state, pg.county, pg.zip_code, pg.acres, pg.status,
           pg.marketing_status, pg.total_contacts, pg.last_contacted_at, pg.first_acquired_at, pg.created_at,
           (
             SELECT COALESCE(
               (
                 SELECT ph
                 FROM property_owners po
                 CROSS JOIN LATERAL unnest(po.phone_numbers) AS ph
                 WHERE po.property_id = pg.id
                 LIMIT 1
               ),
               (
                 SELECT pn.phone_number
                 FROM property_phones pp
                 JOIN phone_numbers pn ON pn.id = pp.phone_number_id
                 WHERE pp.property_id = pg.id
                 ORDER BY pp.position NULLS LAST, pn.phone_number
                 LIMIT 1
               )
             )
           ) AS phone,
           pg.total_count
    FROM page pg
    ORDER BY %s %s NULLS LAST, pg.id
  $q$, v_order, v_dir, v_order, v_dir)
  USING v_pattern, p_status, p_state, p_county, GREATEST(COALESCE(p_limit, 25), 1), GREATEST(COALESCE(p_offset, 0), 0), v_zips, v_account;
END;
$$;

GRANT EXECUTE ON FUNCTION search_properties(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT[], TEXT) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
