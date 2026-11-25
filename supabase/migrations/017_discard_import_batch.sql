-- NextCrest migration 017
-- Discarding an import removes its properties and then its batch record.
--
-- Why: properties and import_batches have no DELETE policy for signed-in users, so a direct delete
-- from the app removes nothing and reports no error. This function does the delete with the permission
-- check built in, in one transaction: if any step fails, nothing changes.
-- Only admins, owners and data managers can discard an import.
-- Idempotent: safe to run more than once.

BEGIN;

CREATE OR REPLACE FUNCTION discard_import_batch(p_batch UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_properties INT := 0;
  v_batches INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to discard an import';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'owner', 'data_manager') THEN
    RAISE EXCEPTION 'Your account cannot discard imports';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM import_batches WHERE id = p_batch) THEN
    RAISE EXCEPTION 'The import was not found';
  END IF;

  -- Owners, identifiers and phone links go with their properties (ON DELETE CASCADE).
  DELETE FROM properties WHERE import_batch_id = p_batch;
  GET DIAGNOSTICS v_properties = ROW_COUNT;

  DELETE FROM import_batches WHERE id = p_batch;
  GET DIAGNOSTICS v_batches = ROW_COUNT;

  RETURN jsonb_build_object('properties_removed', v_properties, 'batches_removed', v_batches);
END;
$$;

REVOKE ALL ON FUNCTION discard_import_batch(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discard_import_batch(UUID) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
