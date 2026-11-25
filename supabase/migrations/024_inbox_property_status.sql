-- NextCrest migration 024
-- Aligns property status with the SmarterContact inbox.
--
-- A property linked to an inbox conversation (property_id on smartercontact_conversations) has been texted,
-- so it should not still read "Never marketed". smartercontact_inbox_mark_properties() applies the same status
-- rules as migration 020, using the inbox:
--   opted_out folder           -> opted_out
--   latest message incoming    -> responded (only when it was never marketed or merely contacted)
--   any other linked conversation -> contacted (only when it was never marketed)
-- Dates never move backwards, and statuses that are already further along are left alone.
-- Only the server (service role) may call it. Returns how many properties changed.

BEGIN;

CREATE OR REPLACE FUNCTION smartercontact_inbox_mark_properties()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed INT := 0;
BEGIN
  WITH linked AS (
    SELECT
      property_id,
      bool_or('opted_out' = ANY(folders)) AS opted_out,
      bool_or(last_direction = 'incoming') AS replied,
      max(last_message_at) AS last_at
    FROM smartercontact_conversations
    WHERE property_id IS NOT NULL
    GROUP BY property_id
  ),
  decided AS (
    SELECT
      l.property_id,
      CASE
        WHEN l.opted_out THEN 'opted_out'
        WHEN l.replied THEN 'responded'
        ELSE 'contacted'
      END AS next_status,
      l.last_at
    FROM linked l
  )
  UPDATE properties p SET
    marketing_status = CASE
      WHEN d.next_status = 'opted_out' THEN 'opted_out'
      WHEN d.next_status = 'responded' AND (p.marketing_status IS NULL OR p.marketing_status IN ('never_contacted', 'contacted')) THEN 'responded'
      WHEN p.marketing_status IS NULL OR p.marketing_status = 'never_contacted' THEN 'contacted'
      ELSE p.marketing_status END,
    last_contacted_at = GREATEST(coalesce(p.last_contacted_at, d.last_at), d.last_at),
    updated_at = now()
  FROM decided d
  WHERE p.id = d.property_id
    AND (
      (d.next_status = 'opted_out' AND p.marketing_status IS DISTINCT FROM 'opted_out')
      OR (d.next_status = 'responded' AND (p.marketing_status IS NULL OR p.marketing_status IN ('never_contacted', 'contacted')))
      OR (d.next_status = 'contacted' AND (p.marketing_status IS NULL OR p.marketing_status = 'never_contacted'))
    );

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION smartercontact_inbox_mark_properties() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION smartercontact_inbox_mark_properties() TO service_role;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
