-- NextCrest migration 015
-- Merges a duplicate property into the property you keep.
--
-- Everything happens in one transaction: if any step fails, nothing changes.
-- Before the duplicate is removed, its full record (property, owners, identifiers, phone links)
-- is saved in property_merge_history.preserved_data, so the original information is never lost.
-- Blank fields on the kept property are filled from the removed one; filled values are never overwritten.
-- Related history (dataset rows, marketing events, responses, follow-ups, campaign contacts, opt-outs,
-- wrong numbers) moves to the kept property. Only admins, owners and data managers can merge.
-- Idempotent: safe to run more than once.

BEGIN;

CREATE OR REPLACE FUNCTION merge_properties(p_source UUID, p_target UUID, p_notes TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_source properties%ROWTYPE;
  v_target properties%ROWTYPE;
  v_owners JSONB;
  v_identifiers JSONB;
  v_phones JSONB;
  v_campaign_contacts JSONB;
  v_history_id UUID;
  v_owners_moved INT := 0;
  v_identifiers_moved INT := 0;
  v_phones_moved INT := 0;
  v_records_moved INT := 0;
  v_marketing_moved INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to merge properties';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'owner', 'data_manager') THEN
    RAISE EXCEPTION 'Your account cannot merge properties';
  END IF;

  IF p_source IS NULL OR p_target IS NULL OR p_source = p_target THEN
    RAISE EXCEPTION 'Choose two different properties to merge';
  END IF;

  -- Lock both rows so nothing else changes them during the merge.
  SELECT * INTO v_source FROM properties WHERE id = p_source FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The property to remove was not found';
  END IF;
  SELECT * INTO v_target FROM properties WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The property to keep was not found';
  END IF;

  -- 1. Save the full record of the property being removed.
  SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb) INTO v_owners
    FROM property_owners o WHERE o.property_id = p_source;
  SELECT COALESCE(jsonb_agg(to_jsonb(i)), '[]'::jsonb) INTO v_identifiers
    FROM property_identifiers i WHERE i.property_id = p_source;
  SELECT COALESCE(jsonb_agg(to_jsonb(pp)), '[]'::jsonb) INTO v_phones
    FROM property_phones pp WHERE pp.property_id = p_source;
  -- Campaign contacts that clash with the kept property are not moved, so they are saved here.
  SELECT COALESCE(jsonb_agg(to_jsonb(cc)), '[]'::jsonb) INTO v_campaign_contacts
    FROM campaign_contacts cc WHERE cc.property_id = p_source;

  INSERT INTO property_merge_history (source_property_id, target_property_id, merged_by, preserved_data, notes)
  VALUES (
    p_source,
    p_target,
    auth.uid(),
    jsonb_build_object(
      'property', to_jsonb(v_source),
      'owners', v_owners,
      'identifiers', v_identifiers,
      'phones', v_phones,
      'campaign_contacts', v_campaign_contacts,
      'kept_before', to_jsonb(v_target)
    ),
    p_notes
  )
  RETURNING id INTO v_history_id;

  -- 2. Fill blank fields on the kept property from the removed one. Existing values are never overwritten.
  --    Parcel keys (fips, apn_normalized) and internal_id are left alone so the unique parcel key holds.
  UPDATE properties SET
    county = COALESCE(NULLIF(county, ''), v_source.county),
    city = COALESCE(NULLIF(city, ''), v_source.city),
    zip_code = COALESCE(NULLIF(zip_code, ''), v_source.zip_code),
    address = COALESCE(NULLIF(address, ''), v_source.address),
    latitude = COALESCE(latitude, v_source.latitude),
    longitude = COALESCE(longitude, v_source.longitude),
    acreage = COALESCE(acreage, v_source.acreage),
    apn_raw = COALESCE(NULLIF(apn_raw, ''), v_source.apn_raw),
    original_source_id = COALESCE(NULLIF(original_source_id, ''), v_source.original_source_id),
    owner_name = COALESCE(NULLIF(owner_name, ''), v_source.owner_name),
    owner_type = COALESCE(NULLIF(owner_type, ''), v_source.owner_type),
    mailing_address = COALESCE(NULLIF(mailing_address, ''), v_source.mailing_address),
    mailing_city = COALESCE(NULLIF(mailing_city, ''), v_source.mailing_city),
    mailing_state = COALESCE(NULLIF(mailing_state, ''), v_source.mailing_state),
    mailing_zip = COALESCE(NULLIF(mailing_zip, ''), v_source.mailing_zip),
    first_acquired_at = LEAST(first_acquired_at, v_source.first_acquired_at),
    last_contacted_at = GREATEST(last_contacted_at, v_source.last_contacted_at),
    updated_at = now()
  WHERE id = p_target;

  -- 3. Move owners, identifiers and phone links that the kept property does not already have.
  UPDATE property_owners o SET property_id = p_target
   WHERE o.property_id = p_source
     AND NOT EXISTS (
       SELECT 1 FROM property_owners x
        WHERE x.property_id = p_target
          AND COALESCE(x.first_name, '') = COALESCE(o.first_name, '')
          AND COALESCE(x.last_name, '') = COALESCE(o.last_name, '')
          AND COALESCE(x.company_name, '') = COALESCE(o.company_name, ''));
  GET DIAGNOSTICS v_owners_moved = ROW_COUNT;

  UPDATE property_identifiers i SET property_id = p_target
   WHERE i.property_id = p_source
     AND NOT EXISTS (
       SELECT 1 FROM property_identifiers x
        WHERE x.property_id = p_target
          AND x.identifier_type = i.identifier_type
          AND x.normalized_value IS NOT DISTINCT FROM i.normalized_value);
  GET DIAGNOSTICS v_identifiers_moved = ROW_COUNT;

  UPDATE property_phones pp SET property_id = p_target
   WHERE pp.property_id = p_source
     AND NOT EXISTS (
       SELECT 1 FROM property_phones x
        WHERE x.property_id = p_target AND x.phone_number_id = pp.phone_number_id);
  GET DIAGNOSTICS v_phones_moved = ROW_COUNT;

  -- 4. Move the purchase, import and marketing history to the kept property.
  UPDATE dataset_records SET property_id = p_target WHERE property_id = p_source;
  GET DIAGNOSTICS v_records_moved = ROW_COUNT;

  UPDATE marketing_events SET property_id = p_target WHERE property_id = p_source;
  UPDATE contact_responses SET property_id = p_target WHERE property_id = p_source;
  UPDATE follow_up_tasks SET property_id = p_target WHERE property_id = p_source;
  UPDATE opt_outs SET property_id = p_target WHERE property_id = p_source;
  UPDATE wrong_numbers SET property_id = p_target WHERE property_id = p_source;

  UPDATE campaign_contacts cc SET property_id = p_target
   WHERE cc.property_id = p_source
     AND NOT EXISTS (
       SELECT 1 FROM campaign_contacts x
        WHERE x.property_id = p_target
          AND x.campaign_id = cc.campaign_id
          AND x.phone_number IS NOT DISTINCT FROM cc.phone_number);
  GET DIAGNOSTICS v_marketing_moved = ROW_COUNT;

  -- Keep earlier merges that pointed at the removed property.
  UPDATE property_merge_history SET target_property_id = p_target WHERE target_property_id = p_source;

  -- 5. Remove the duplicate. Anything it still has (owners, identifiers, phone links, skipped campaign
  --    contacts) goes with it, and all of it is already saved in step 1. Duplicate-candidate pairs are removed too.
  DELETE FROM properties WHERE id = p_source;

  RETURN jsonb_build_object(
    'history_id', v_history_id,
    'kept_property_id', p_target,
    'removed_property_id', p_source,
    'owners_moved', v_owners_moved,
    'identifiers_moved', v_identifiers_moved,
    'phones_moved', v_phones_moved,
    'dataset_records_moved', v_records_moved,
    'marketing_rows_moved', v_marketing_moved
  );
END;
$$;

REVOKE ALL ON FUNCTION merge_properties(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merge_properties(UUID, UUID, TEXT) TO authenticated;

COMMIT;

-- Tell the Supabase API (PostgREST) to reload its schema cache so the function is callable.
NOTIFY pgrst, 'reload schema';
