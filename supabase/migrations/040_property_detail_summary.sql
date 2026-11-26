-- NextCrest migration 040
-- The property page loaded every property to show one. It now fetches the property itself, and the county summary the
-- dataset name is built from comes from this function, so the page does not read the whole list.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_properties_state_county ON properties (state, county);

CREATE OR REPLACE FUNCTION property_county_summary(p_state TEXT, p_county TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'total', count(*),
    'min_acres', min(acreage),
    'max_acres', max(acreage),
    'first_acquired', min(coalesce(first_acquired_at, created_at))
  )
  FROM properties
  WHERE state = p_state AND county = p_county
$$;

GRANT EXECUTE ON FUNCTION property_county_summary(TEXT, TEXT) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
