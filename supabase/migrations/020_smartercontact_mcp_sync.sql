-- NextCrest migration 020
-- Loads SmarterContact campaign history pulled through the SmarterContact MCP connector (server/sync/).
--
-- Unlike migration 016 (CSV export, matched by APN), the connector gives a phone number per contact, so
-- contacts are matched to properties by phone number. A phone is linked only when it belongs to exactly one
-- property. Phones that match no property, or more than one, are returned for review and never written.
--
-- smartercontact_mcp_sync(p_rows, p_apply, p_actor):
--   p_apply = false  preview: counts and review list only. Nothing is written.
--   p_apply = true   writes in one transaction: phone link, campaign contact, contact count, last contacted
--                    date, responded and opted-out status. Opt-out replies are recorded as phone suppressions.
-- Each row: { phone, last_campaign_at, replied, opted_out, name }. Campaign text is not returned by the connector,
-- so the campaign is recorded under one name, MCP_CAMPAIGN_NAME below.
-- Idempotent: running the same rows again adds nothing new (links, contacts and suppressions are unique).
-- Only the server (service role) may call it. The app's signed-in users cannot.

BEGIN;

CREATE OR REPLACE FUNCTION smartercontact_mcp_sync(
  p_rows JSONB,
  p_apply BOOLEAN DEFAULT false,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_campaign CONSTANT TEXT := 'SmarterContact history (MCP backfill)';
  r JSONB;
  v_phone TEXT;
  v_last TIMESTAMP WITH TIME ZONE;
  v_replied BOOLEAN;
  v_opted_out BOOLEAN;
  v_name TEXT;
  v_prop UUID;
  v_count INT;
  v_phone_id UUID;
  v_campaign_id UUID;
  v_actor UUID;
  v_pos INT;
  v_inserted INT;
  v_total INT := 0;
  v_matched INT := 0;
  v_phones INT := 0;
  v_contacts INT := 0;
  v_suppressions INT := 0;
  v_review JSONB := '[]'::jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'The rows must be a list';
  END IF;

  v_actor := p_actor;
  IF v_actor IS NULL THEN
    SELECT id INTO v_actor FROM profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
  END IF;
  IF p_apply AND v_actor IS NULL THEN
    RAISE EXCEPTION 'No admin profile to record the campaign under';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_total := v_total + 1;
    v_phone := right(regexp_replace(coalesce(r->>'phone', ''), '\D', '', 'g'), 10);
    IF v_phone !~ '^[0-9]{10}$' THEN
      v_review := v_review || jsonb_build_array(jsonb_build_object('phone', r->>'phone', 'name', r->>'name', 'reason', 'Not a valid phone number'));
      CONTINUE;
    END IF;

    v_last := coalesce(nullif(r->>'last_campaign_at', '')::timestamp with time zone, now());
    v_replied := coalesce((r->>'replied')::boolean, false);
    v_opted_out := coalesce((r->>'opted_out')::boolean, false);
    v_name := coalesce(r->>'name', '');

    -- Properties that have this phone: on a phone link, or as one of the owner phone numbers.
    SELECT count(*)::int, (array_agg(p.id))[1]
      INTO v_count, v_prop
      FROM properties p
     WHERE p.id IN (
             SELECT pp.property_id
               FROM property_phones pp
               JOIN phone_numbers pn ON pn.id = pp.phone_number_id
              WHERE pn.phone_number = v_phone)
        OR p.id IN (
             SELECT po.property_id
               FROM property_owners po
              WHERE EXISTS (
                SELECT 1 FROM unnest(po.phone_numbers) AS ph
                 WHERE right(regexp_replace(coalesce(ph, ''), '\D', '', 'g'), 10) = v_phone));

    IF v_count = 0 THEN
      v_review := v_review || jsonb_build_array(jsonb_build_object('phone', v_phone, 'name', v_name, 'reason', 'No property has this phone number'));
      CONTINUE;
    END IF;
    IF v_count > 1 THEN
      v_review := v_review || jsonb_build_array(jsonb_build_object('phone', v_phone, 'name', v_name, 'reason', 'Phone is on more than one property'));
      CONTINUE;
    END IF;

    v_matched := v_matched + 1;
    IF NOT p_apply THEN
      CONTINUE;
    END IF;

    -- Phone number and its link to the property.
    INSERT INTO phone_numbers (phone_number) VALUES (v_phone) ON CONFLICT (phone_number) DO NOTHING;
    SELECT id INTO v_phone_id FROM phone_numbers WHERE phone_number = v_phone;
    SELECT coalesce(max(position), 0) + 1 INTO v_pos FROM property_phones WHERE property_id = v_prop;
    INSERT INTO property_phones (property_id, phone_number_id, position)
    VALUES (v_prop, v_phone_id, v_pos)
    ON CONFLICT (property_id, phone_number_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_phones := v_phones + v_inserted;

    -- Campaign contact. One campaign record holds all MCP-loaded history.
    SELECT id INTO v_campaign_id FROM campaigns WHERE name = c_campaign AND source = 'smartercontact' LIMIT 1;
    IF v_campaign_id IS NULL THEN
      INSERT INTO campaigns (name, source, status, created_by)
      VALUES (c_campaign, 'smartercontact', 'imported', v_actor)
      RETURNING id INTO v_campaign_id;
    END IF;
    INSERT INTO campaign_contacts (campaign_id, property_id, phone_number)
    SELECT v_campaign_id, v_prop, v_phone
     WHERE NOT EXISTS (
       SELECT 1 FROM campaign_contacts cc
        WHERE cc.campaign_id = v_campaign_id AND cc.property_id = v_prop AND cc.phone_number IS NOT DISTINCT FROM v_phone);
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_contacts := v_contacts + v_inserted;

    -- Opt-out: the contact replied with a stop word. Suppress the phone; the property is opted out.
    IF v_opted_out THEN
      INSERT INTO phone_suppressions (phone_number_id, suppression_type, source)
      VALUES (v_phone_id, 'opt_out', 'smartercontact-mcp')
      ON CONFLICT (phone_number_id, suppression_type) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_suppressions := v_suppressions + v_inserted;
    END IF;

    -- Status. Dates never move backwards. A reply means the property is no longer marketed to by default.
    UPDATE properties SET
      marketing_status = CASE
        WHEN v_opted_out THEN 'opted_out'
        WHEN v_replied AND (marketing_status IS NULL OR marketing_status IN ('never_contacted', 'contacted')) THEN 'responded'
        WHEN marketing_status IS NULL OR marketing_status = 'never_contacted' THEN 'contacted'
        ELSE marketing_status END,
      total_contacts = GREATEST(
        coalesce(total_contacts, 0),
        (SELECT count(DISTINCT cc.campaign_id)::int FROM campaign_contacts cc WHERE cc.property_id = v_prop)),
      last_contacted_at = GREATEST(coalesce(last_contacted_at, v_last), v_last),
      updated_at = now()
     WHERE id = v_prop;
  END LOOP;

  RETURN jsonb_build_object(
    'mode', CASE WHEN p_apply THEN 'applied' ELSE 'preview' END,
    'rows_total', v_total,
    'rows_matched', v_matched,
    'rows_review', jsonb_array_length(v_review),
    'phones_linked', v_phones,
    'contacts_linked', v_contacts,
    'opt_outs_recorded', v_suppressions,
    'review', v_review
  );
END;
$$;

-- Only the server (service role) may call this. Signed-in users and anonymous callers may not.
REVOKE ALL ON FUNCTION smartercontact_mcp_sync(JSONB, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
-- Supabase always has the service_role role. The check is only so the test harness, which lacks it, still runs.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION smartercontact_mcp_sync(JSONB, BOOLEAN, UUID) TO service_role;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
