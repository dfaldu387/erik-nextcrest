-- NextCrest migration 019
-- Adds the distinct ZIP codes to property_filter_options, so the Properties screen can offer a ZIP picker.
--
-- Each entry is one state, county and 5-digit ZIP that exists in the properties table. A stored ZIP+4
-- (for example 32068-0001) is reduced to its first five digits. Entries without a 5-digit ZIP are left out.
-- The function keeps its name, argument list and return type, so existing callers are unaffected.

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
    ),
    'zips', COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('state', d.state, 'county', d.county, 'zip', d.zip) ORDER BY d.state, d.county, d.zip)
        FROM (
          SELECT DISTINCT state, county, LEFT(btrim(zip_code), 5) AS zip
          FROM properties
          WHERE zip_code IS NOT NULL AND btrim(zip_code) ~ '^[0-9]{5}'
        ) d
      ),
      '[]'::jsonb
    )
  );
$$;
