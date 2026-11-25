-- NextCrest migration 016
-- Milestone 2 core: imports SmarterContact campaign history (contacts, campaigns and phone numbers)
-- and matches each contact to a property by APN.
--
-- smartercontact_import(p_filename, p_rows, p_apply):
--   p_apply = false  preview only: counts matches and lists rows that need review. Nothing is written.
--   p_apply = true   saves the matched rows in one transaction: campaigns, campaign contacts, phone links,
--                    and the property's contact status, count and last-contacted date.
-- Rows that match no property, or more than one, are listed for review and never saved.
-- Running the same file again changes nothing (rows already linked are skipped).
-- Idempotent: safe to run more than once.

BEGIN;

-- Normalized APN: upper case, letters and digits only, leading zeros removed. Used for matching.
CREATE OR REPLACE FUNCTION smartercontact_norm_apn(p TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ltrim(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g'), '0')
$$;

CREATE INDEX IF NOT EXISTS idx_properties_smartercontact_apn
  ON properties (upper(state), lower(county), smartercontact_norm_apn(apn_raw));

CREATE TABLE IF NOT EXISTS smartercontact_import_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  rows_total INT NOT NULL,
  rows_matched INT NOT NULL,
  rows_review INT NOT NULL,
  contacts_linked INT NOT NULL,
  phones_linked INT NOT NULL,
  campaigns_touched INT NOT NULL,
  review JSONB
);

ALTER TABLE smartercontact_import_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY smartercontact_import_runs_read ON smartercontact_import_runs
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION smartercontact_import(p_filename TEXT, p_rows JSONB, p_apply BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  r JSONB;
  v_apn TEXT;
  v_state TEXT;
  v_county TEXT;
  v_phone TEXT;
  v_date TIMESTAMP WITH TIME ZONE;
  v_campaign TEXT;
  v_campaign_id UUID;
  v_prop UUID;
  v_count INT;
  v_phone_id UUID;
  v_pos INT;
  v_inserted INT;
  v_total INT := 0;
  v_matched INT := 0;
  v_contacts INT := 0;
  v_phones INT := 0;
  v_campaigns TEXT[] := '{}';
  v_review JSONB := '[]'::jsonb;
  v_review_count INT := 0;
  v_run UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to import SmarterContact history';
  END IF;

  IF p_apply THEN
    SELECT role INTO v_role FROM profiles WHERE id = v_uid;
    IF v_role IS NULL OR v_role NOT IN ('admin', 'owner', 'data_manager') THEN
      RAISE EXCEPTION 'Your account cannot import SmarterContact history';
    END IF;
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'The rows must be a list';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_total := v_total + 1;
    v_apn := smartercontact_norm_apn(r->>'apn');
    v_state := upper(trim(coalesce(r->>'state', '')));
    v_county := trim(coalesce(r->>'county', ''));
    v_phone := right(regexp_replace(coalesce(r->>'phone', ''), '\D', '', 'g'), 10);
    IF v_phone !~ '^[0-9]{10}$' THEN
      v_phone := NULL;
    END IF;

    IF v_apn = '' THEN
      v_review_count := v_review_count + 1;
      IF v_review_count <= 500 THEN
        v_review := v_review || jsonb_build_array(jsonb_build_object('row', v_total, 'apn', r->>'apn', 'owner', r->>'owner', 'reason', 'Missing APN'));
      END IF;
      CONTINUE;
    END IF;

    SELECT count(*)::int, (array_agg(p.id))[1]
      INTO v_count, v_prop
      FROM properties p
     WHERE upper(p.state) = v_state
       AND lower(p.county) = lower(v_county)
       AND smartercontact_norm_apn(p.apn_raw) = v_apn;

    IF v_count = 0 THEN
      v_review_count := v_review_count + 1;
      IF v_review_count <= 500 THEN
        v_review := v_review || jsonb_build_array(jsonb_build_object('row', v_total, 'apn', r->>'apn', 'owner', r->>'owner', 'reason', 'No property with this APN in the county'));
      END IF;
      CONTINUE;
    END IF;

    IF v_count > 1 THEN
      v_review_count := v_review_count + 1;
      IF v_review_count <= 500 THEN
        v_review := v_review || jsonb_build_array(jsonb_build_object('row', v_total, 'apn', r->>'apn', 'owner', r->>'owner', 'reason', 'APN matches more than one property'));
      END IF;
      CONTINUE;
    END IF;

    v_matched := v_matched + 1;
    v_date := coalesce(nullif(r->>'date_added', '')::timestamp with time zone, now());

    IF p_apply THEN
      -- Phone number and its link to the property.
      IF v_phone IS NOT NULL THEN
        INSERT INTO phone_numbers (phone_number) VALUES (v_phone) ON CONFLICT (phone_number) DO NOTHING;
        SELECT id INTO v_phone_id FROM phone_numbers WHERE phone_number = v_phone;
        SELECT coalesce(max(position), 0) + 1 INTO v_pos FROM property_phones WHERE property_id = v_prop;
        INSERT INTO property_phones (property_id, phone_number_id, position)
        VALUES (v_prop, v_phone_id, v_pos)
        ON CONFLICT (property_id, phone_number_id) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        v_phones := v_phones + v_inserted;
      END IF;

      -- Each campaign the contact was in.
      FOR v_campaign IN
        SELECT DISTINCT trim(c) FROM jsonb_array_elements_text(coalesce(r->'campaigns', '[]'::jsonb)) AS c
         WHERE trim(c) <> ''
      LOOP
        SELECT id INTO v_campaign_id FROM campaigns WHERE name = v_campaign AND source = 'smartercontact' LIMIT 1;
        IF v_campaign_id IS NULL THEN
          INSERT INTO campaigns (name, source, status, created_by)
          VALUES (v_campaign, 'smartercontact', 'imported', v_uid)
          RETURNING id INTO v_campaign_id;
        END IF;

        INSERT INTO campaign_contacts (campaign_id, property_id, phone_number)
        SELECT v_campaign_id, v_prop, v_phone
         WHERE NOT EXISTS (
           SELECT 1 FROM campaign_contacts cc
            WHERE cc.campaign_id = v_campaign_id
              AND cc.property_id = v_prop
              AND cc.phone_number IS NOT DISTINCT FROM v_phone);
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        v_contacts := v_contacts + v_inserted;

        IF NOT (v_campaign = ANY (v_campaigns)) THEN
          v_campaigns := array_append(v_campaigns, v_campaign);
        END IF;
      END LOOP;

      -- Status: a property that was in a campaign is no longer "never contacted". Dates never move backwards.
      UPDATE properties SET
        marketing_status = CASE
          WHEN marketing_status IS NULL OR marketing_status = 'never_contacted' THEN 'contacted'
          ELSE marketing_status END,
        total_contacts = GREATEST(
          coalesce(total_contacts, 0),
          (SELECT count(DISTINCT cc.campaign_id)::int FROM campaign_contacts cc WHERE cc.property_id = v_prop)),
        last_contacted_at = GREATEST(coalesce(last_contacted_at, v_date), v_date),
        updated_at = now()
       WHERE id = v_prop;
    END IF;
  END LOOP;

  IF p_apply THEN
    INSERT INTO smartercontact_import_runs (
      created_by, filename, rows_total, rows_matched, rows_review,
      contacts_linked, phones_linked, campaigns_touched, review)
    VALUES (
      v_uid, p_filename, v_total, v_matched, v_review_count,
      v_contacts, v_phones, cardinality(v_campaigns), v_review)
    RETURNING id INTO v_run;
  END IF;

  RETURN jsonb_build_object(
    'applied', p_apply,
    'run_id', v_run,
    'rows_total', v_total,
    'rows_matched', v_matched,
    'rows_review', v_review_count,
    'contacts_linked', v_contacts,
    'phones_linked', v_phones,
    'campaigns', cardinality(v_campaigns),
    'review', v_review
  );
END;
$$;

REVOKE ALL ON FUNCTION smartercontact_import(TEXT, JSONB, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION smartercontact_import(TEXT, JSONB, BOOLEAN) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
