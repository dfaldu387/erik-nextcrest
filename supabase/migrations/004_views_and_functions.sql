-- NextCrest Views and Helper Functions
-- Database: PostgreSQL (Supabase)
-- Version: 1.0.0
-- Migration: 004
-- Purpose: Create views and functions for common queries

-- ============================================================================
-- VIEWS: PROPERTY SUMMARIES
-- ============================================================================

-- View: Property with recent contact history
CREATE OR REPLACE VIEW property_with_contact_history AS
SELECT
  p.id,
  p.internal_id,
  p.state,
  p.county,
  p.owner_name,
  p.acreage,
  p.zip_code,
  p.marketing_status,
  p.total_contacts,
  p.last_contacted_at,
  p.next_contact_eligible_at,
  COUNT(me.id) as recent_contact_count,
  MAX(me.event_date) as latest_event_date
FROM properties p
LEFT JOIN marketing_events me ON p.id = me.property_id
  AND me.event_date > NOW() - INTERVAL '30 days'
GROUP BY p.id, p.internal_id, p.state, p.county, p.owner_name,
         p.acreage, p.zip_code, p.marketing_status, p.total_contacts,
         p.last_contacted_at, p.next_contact_eligible_at;

-- View: Properties by status
CREATE OR REPLACE VIEW properties_by_status AS
SELECT
  marketing_status,
  COUNT(*) as count,
  AVG(total_contacts) as avg_contacts,
  COUNT(CASE WHEN last_contacted_at IS NOT NULL THEN 1 END) as contacted
FROM properties
GROUP BY marketing_status;

-- View: Properties by county
CREATE OR REPLACE VIEW properties_by_county AS
SELECT
  state,
  county,
  COUNT(*) as total_records,
  SUM(acreage) as total_acreage,
  AVG(total_contacts) as avg_contacts,
  COUNT(CASE WHEN marketing_status = 'never_contacted' THEN 1 END) as never_contacted,
  COUNT(CASE WHEN marketing_status IN ('followup_due', 'contacted') THEN 1 END) as due_for_followup
FROM properties
WHERE county IS NOT NULL
GROUP BY state, county
ORDER BY state, county;

-- View: Campaign performance
CREATE OR REPLACE VIEW campaign_performance AS
SELECT
  c.id,
  c.name,
  c.status,
  COUNT(DISTINCT me.property_id) as contacts_attempted,
  COUNT(CASE WHEN me.message_status = 'delivered' THEN 1 END) as messages_delivered,
  COUNT(CASE WHEN cr.id IS NOT NULL THEN 1 END) as responses,
  ROUND(
    COUNT(CASE WHEN cr.id IS NOT NULL THEN 1 END)::NUMERIC /
    NULLIF(COUNT(CASE WHEN me.message_status = 'delivered' THEN 1 END), 0) * 100,
    2
  ) as response_rate_percent
FROM campaigns c
LEFT JOIN marketing_events me ON c.id = me.campaign_id
LEFT JOIN contact_responses cr ON me.id = cr.marketing_event_id
GROUP BY c.id, c.name, c.status;

-- View: Team performance
CREATE OR REPLACE VIEW team_performance AS
SELECT
  p.id,
  p.full_name,
  p.role,
  COUNT(DISTINCT ft.id) as tasks_assigned,
  COUNT(CASE WHEN ft.status = 'completed' THEN 1 END) as tasks_completed,
  COUNT(DISTINCT me.id) as events_created,
  COUNT(DISTINCT cr.id) as responses_recorded,
  COUNT(DISTINCT al.id) as actions_logged
FROM profiles p
LEFT JOIN follow_up_tasks ft ON p.id = ft.assigned_to
LEFT JOIN marketing_events me ON p.id = me.property_id
LEFT JOIN contact_responses cr ON p.id = cr.assigned_to
LEFT JOIN activity_logs al ON p.id = al.user_id AND al.created_at > NOW() - INTERVAL '30 days'
WHERE p.role != 'read_only'
GROUP BY p.id, p.full_name, p.role;

-- ============================================================================
-- FUNCTIONS: BUSINESS LOGIC
-- ============================================================================

-- Function: Normalize APN
CREATE OR REPLACE FUNCTION normalize_apn(apn_input TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Trim whitespace, uppercase, remove common separators
  RETURN UPPER(TRIM(REGEXP_REPLACE(apn_input, '[^A-Z0-9]', '', 'g')));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function: Check if property is duplicate
CREATE OR REPLACE FUNCTION is_property_duplicate(
  p_state TEXT,
  p_county TEXT,
  p_normalized_apn TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM property_identifiers pi
    JOIN properties p ON pi.property_id = p.id
    WHERE p.state = p_state
      AND COALESCE(p.county, '') = COALESCE(p_county, '')
      AND pi.normalized_value = p_normalized_apn
  ) INTO v_exists;

  RETURN v_exists;
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate follow-up eligibility
CREATE OR REPLACE FUNCTION calculate_followup_eligibility(
  p_property_id UUID,
  p_max_contacts INT DEFAULT 3,
  p_days_between_contact INT DEFAULT 7,
  p_rehit_days INT DEFAULT 90
)
RETURNS TABLE(eligible BOOLEAN, reason TEXT, next_eligible_at TIMESTAMP) AS $$
DECLARE
  v_last_contact TIMESTAMP;
  v_contact_count INT;
  v_status TEXT;
  v_eligible BOOLEAN;
  v_reason TEXT;
  v_next_eligible TIMESTAMP;
BEGIN
  -- Get property info
  SELECT last_contacted_at, total_contacts, marketing_status
  INTO v_last_contact, v_contact_count, v_status
  FROM properties
  WHERE id = p_property_id;

  -- Check suppression status
  IF v_status IN ('opted_out', 'wrong_number') THEN
    v_eligible := false;
    v_reason := 'Contact is suppressed (' || v_status || ')';
    v_next_eligible := NULL;
  -- Never contacted
  ELSIF v_last_contact IS NULL THEN
    v_eligible := true;
    v_reason := 'Never contacted, ready for first contact';
    v_next_eligible := NOW();
  -- Contact limit reached
  ELSIF v_contact_count >= p_max_contacts THEN
    -- Check if 90-day window has passed
    IF NOW() - INTERVAL '1 day' * p_rehit_days > v_last_contact THEN
      v_eligible := true;
      v_reason := '90-day window passed, eligible for re-marketing';
      v_next_eligible := NOW();
    ELSE
      v_eligible := false;
      v_reason := 'Contact limit reached, not eligible for 90 days';
      v_next_eligible := v_last_contact + INTERVAL '1 day' * p_rehit_days;
    END IF;
  -- Between contacts
  ELSE
    IF NOW() - INTERVAL '1 day' * p_days_between_contact > v_last_contact THEN
      v_eligible := true;
      v_reason := 'Ready for next contact (' || (v_contact_count + 1) || ' of ' || p_max_contacts || ')';
      v_next_eligible := NOW();
    ELSE
      v_eligible := false;
      v_reason := 'Waiting ' || p_days_between_contact || ' days between contacts';
      v_next_eligible := v_last_contact + INTERVAL '1 day' * p_days_between_contact;
    END IF;
  END IF;

  RETURN QUERY SELECT v_eligible, v_reason, v_next_eligible;
END;
$$ LANGUAGE plpgsql;

-- Function: Get duplicate properties
CREATE OR REPLACE FUNCTION find_duplicate_properties(
  p_property_id UUID
)
RETURNS TABLE(duplicate_id UUID, match_score NUMERIC, match_reason TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p2.id,
    1.0::NUMERIC as match_score,
    'Exact APN match (Normalized)' as match_reason
  FROM property_identifiers pi1
  JOIN properties p1 ON pi1.property_id = p1.id
  JOIN property_identifiers pi2 ON pi1.normalized_value = pi2.normalized_value
    AND pi1.identifier_type = pi2.identifier_type
  JOIN properties p2 ON pi2.property_id = p2.id
  WHERE p1.id = p_property_id
    AND p2.id != p_property_id
    AND p1.state = p2.state
  UNION
  SELECT
    p2.id,
    0.8::NUMERIC,
    'Owner name + mailing address match'
  FROM properties p1, properties p2
  WHERE p1.id = p_property_id
    AND p2.id != p_property_id
    AND p1.owner_name = p2.owner_name
    AND p1.mailing_address = p2.mailing_address
    AND p1.state = p2.state;
END;
$$ LANGUAGE plpgsql;

-- Function: Get marketing status for property
CREATE OR REPLACE FUNCTION get_marketing_status(p_property_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_status TEXT;
  v_total_contacts INT;
  v_last_contact TIMESTAMP;
BEGIN
  SELECT total_contacts, last_contacted_at, marketing_status
  INTO v_total_contacts, v_last_contact, v_status
  FROM properties
  WHERE id = p_property_id;

  RETURN COALESCE(v_status, 'never_contacted');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Update property contact count
-- ============================================================================

CREATE OR REPLACE FUNCTION update_property_contact_metrics()
RETURNS TRIGGER AS $$
BEGIN
  -- Update property contact metrics when marketing event is inserted
  IF NEW.event_type = 'message_sent' THEN
    UPDATE properties
    SET
      total_contacts = total_contacts + 1,
      last_contacted_at = NEW.event_date
    WHERE id = NEW.property_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updating contact metrics
DROP TRIGGER IF EXISTS update_contact_metrics ON marketing_events;
CREATE TRIGGER update_contact_metrics
  AFTER INSERT ON marketing_events
  FOR EACH ROW
  EXECUTE FUNCTION update_property_contact_metrics();

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Views created: 5
-- Functions created: 5
-- Triggers updated: 1
-- Ready for optimization and analytics queries
