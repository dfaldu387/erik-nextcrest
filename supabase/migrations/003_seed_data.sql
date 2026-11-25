-- NextCrest Seed Data
-- Database: PostgreSQL (Supabase)
-- Version: 1.0.0
-- Migration: 003
-- Purpose: Populate with realistic sample data for testing

-- ============================================================================
-- SAMPLE USER DATA
-- ============================================================================

-- Note: Profiles are automatically created by Supabase Auth
-- For development, we'll create sample profiles with known UUIDs
-- In production, users are created through the signup flow

-- Sample profile for testing (Eric - Owner)
INSERT INTO profiles (
  id, email, full_name, role, created_at, updated_at
) VALUES (
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'eric@nextcrest.com',
  'Eric Martinez',
  'owner',
  now(),
  now()
) ON CONFLICT (email) DO NOTHING;

-- Sample profile for testing (Annalia - Team Member)
INSERT INTO profiles (
  id, email, full_name, role, created_at, updated_at
) VALUES (
  'a0000000-0000-0000-0000-000000000002'::uuid,
  'annalia@nextcrest.com',
  'Annalia Rodriguez',
  'marketing_user',
  now(),
  now()
) ON CONFLICT (email) DO NOTHING;

-- Sample profile (Data Manager)
INSERT INTO profiles (
  id, email, full_name, role, created_at, updated_at
) VALUES (
  'a0000000-0000-0000-0000-000000000003'::uuid,
  'admin@nextcrest.com',
  'Admin User',
  'data_manager',
  now(),
  now()
) ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- SAMPLE PROPERTY DATA (Texas - Bexar County)
-- ============================================================================

INSERT INTO properties (
  internal_id, source, state, county, city, zip_code, address,
  acreage, property_type, land_use, owner_name, owner_type,
  mailing_address, mailing_city, mailing_state, mailing_zip,
  total_contacts, marketing_status, first_acquired_at, created_at, updated_at
) VALUES
  ('TX-BX-001', 'land_portal', 'TX', 'Bexar', 'San Antonio', '78201', '123 Ranch Road',
   45.5, 'Land', 'Agricultural', 'John Smith', 'Individual',
   '456 Main St', 'San Antonio', 'TX', '78201',
   0, 'never_contacted', now(), now(), now()),

  ('TX-BX-002', 'land_portal', 'TX', 'Bexar', 'San Antonio', '78202', '789 Farm Lane',
   120.0, 'Land', 'Residential', 'Smith Family LLC', 'LLC',
   '789 Farm Lane', 'San Antonio', 'TX', '78202',
   1, 'contacted', now() - interval '5 days', now(), now()),

  ('TX-BX-003', 'land_portal', 'TX', 'Bexar', 'Universal City', '78148', '321 Acre Drive',
   85.75, 'Land', 'Mixed Use', 'Maria Garcia', 'Individual',
   '321 Acre Drive', 'Universal City', 'TX', '78148',
   2, 'followup_due', now() - interval '8 days', now(), now()),

  ('TX-BX-004', 'land_portal', 'TX', 'Bexar', 'New Braunfels', '78130', '555 Property Road',
   250.0, 'Land', 'Agricultural', 'Texas Ranch Holdings', 'Corporation',
   '100 Corporate Blvd', 'Austin', 'TX', '78701',
   3, 'contacted', now() - interval '12 days', now(), now());

-- ============================================================================
-- SAMPLE PROPERTY DATA (Florida - Broward County)
-- ============================================================================

INSERT INTO properties (
  internal_id, source, state, county, city, zip_code, address,
  acreage, property_type, land_use, owner_name, owner_type,
  mailing_address, mailing_city, mailing_state, mailing_zip,
  total_contacts, marketing_status, first_acquired_at, created_at, updated_at
) VALUES
  ('FL-BR-001', 'land_portal', 'FL', 'Broward', 'Fort Lauderdale', '33301', '100 Beach Road',
   8.5, 'Land', 'Residential', 'Robert Johnson', 'Individual',
   '100 Beach Road', 'Fort Lauderdale', 'FL', '33301',
   0, 'never_contacted', now(), now(), now()),

  ('FL-BR-002', 'land_portal', 'FL', 'Broward', 'Deerfield Beach', '33441', '200 Ocean View',
   15.0, 'Land', 'Commercial', 'Coastal Properties Inc', 'Corporation',
   '200 Ocean View', 'Deerfield Beach', 'FL', '33441',
   1, 'contacted', now() - interval '3 days', now(), now());

-- ============================================================================
-- SAMPLE PROPERTY DATA (North Carolina - Wake County)
-- ============================================================================

INSERT INTO properties (
  internal_id, source, state, county, city, zip_code, address,
  acreage, property_type, land_use, owner_name, owner_type,
  mailing_address, mailing_city, mailing_state, mailing_zip,
  total_contacts, marketing_status, first_acquired_at, created_at, updated_at
) VALUES
  ('NC-WK-001', 'land_portal', 'NC', 'Wake', 'Raleigh', '27601', '50 Tech Drive',
   32.0, 'Land', 'Commercial', 'James Wilson', 'Individual',
   '50 Tech Drive', 'Raleigh', 'NC', '27601',
   0, 'never_contacted', now(), now(), now()),

  ('NC-WK-002', 'land_portal', 'NC', 'Wake', 'Durham', '27701', '75 Research Way',
   95.5, 'Land', 'Industrial', 'Triangle Development Group', 'LLC',
   '1000 Innovation Dr', 'Research Triangle Park', 'NC', '27709',
   2, 'contacted', now() - interval '10 days', now(), now());

-- ============================================================================
-- SAMPLE PROPERTY IDENTIFIERS (APNs)
-- ============================================================================

INSERT INTO property_identifiers (
  property_id, identifier_type, identifier_value, normalized_value, source
) SELECT id, 'APN', '123-456-789', '123456789', 'land_portal'
FROM properties WHERE internal_id = 'TX-BX-001';

INSERT INTO property_identifiers (
  property_id, identifier_type, identifier_value, normalized_value, source
) SELECT id, 'APN', '123-456-790', '123456790', 'land_portal'
FROM properties WHERE internal_id = 'TX-BX-002';

INSERT INTO property_identifiers (
  property_id, identifier_type, identifier_value, normalized_value, source
) SELECT id, 'APN', '123-456-791', '123456791', 'land_portal'
FROM properties WHERE internal_id = 'TX-BX-003';

INSERT INTO property_identifiers (
  property_id, identifier_type, identifier_value, normalized_value, source
) SELECT id, 'APN', '001-234-567', '001234567', 'land_portal'
FROM properties WHERE internal_id = 'FL-BR-001';

INSERT INTO property_identifiers (
  property_id, identifier_type, identifier_value, normalized_value, source
) SELECT id, 'APN', '987-654-321', '987654321', 'land_portal'
FROM properties WHERE internal_id = 'NC-WK-001';

-- ============================================================================
-- SAMPLE DATA PURCHASES
-- ============================================================================

INSERT INTO data_purchases (
  dataset_name, source_provider, filter_states, filter_counties,
  acreage_min, acreage_max, original_record_count, imported_record_count,
  duplicate_count, new_property_count, purchase_date, purchased_by,
  import_status, notes
) VALUES
  ('TX_Bexar_10yr_2-200ac_Nov2026_1769', 'land_portal',
   ARRAY['TX'], ARRAY['Bexar'],
   2.0, 200.0, 1769, 1769, 0, 1769,
   now() - interval '5 days',
   'a0000000-0000-0000-0000-000000000001'::uuid,
   'completed',
   'Initial Bexar County data acquisition'),

  ('FL_Broward_5yr_0.5-50ac_Nov2026_892', 'land_portal',
   ARRAY['FL'], ARRAY['Broward'],
   0.5, 50.0, 892, 892, 0, 892,
   now() - interval '3 days',
   'a0000000-0000-0000-0000-000000000001'::uuid,
   'completed',
   'Broward County residential properties');

-- ============================================================================
-- SAMPLE CAMPAIGNS
-- ============================================================================

INSERT INTO campaigns (
  name, description, source, status, created_by
) VALUES
  ('Bexar County Land Owners - Wave 1', 'First contact campaign for Bexar County properties',
   'smartercontact', 'active',
   'a0000000-0000-0000-0000-000000000001'::uuid),

  ('Broward County Follow-up - Wave 2', 'Second round follow-up for Broward properties',
   'smartercontact', 'active',
   'a0000000-0000-0000-0000-000000000002'::uuid);

-- ============================================================================
-- SAMPLE MARKETING EVENTS
-- ============================================================================

-- Events for TX-BX-002
INSERT INTO marketing_events (
  property_id, campaign_id, event_type, event_date, phone_number,
  message_status, source_platform
) SELECT
  p.id, c.id, 'message_sent', now() - interval '5 days', '210-555-0001',
  'delivered', 'smartercontact'
FROM properties p, campaigns c
WHERE p.internal_id = 'TX-BX-002' AND c.name LIKE 'Bexar%';

-- Events for TX-BX-003
INSERT INTO marketing_events (
  property_id, campaign_id, event_type, event_date, phone_number,
  message_status, source_platform
) SELECT
  p.id, c.id, 'message_sent', now() - interval '8 days', '210-555-0002',
  'delivered', 'smartercontact'
FROM properties p, campaigns c
WHERE p.internal_id = 'TX-BX-003' AND c.name LIKE 'Bexar%';

INSERT INTO marketing_events (
  property_id, campaign_id, event_type, event_date, phone_number,
  message_status, source_platform
) SELECT
  p.id, c.id, 'message_sent', now() - interval '3 days', '210-555-0002',
  'delivered', 'smartercontact'
FROM properties p, campaigns c
WHERE p.internal_id = 'TX-BX-003' AND c.name LIKE 'Bexar%';

-- Events for TX-BX-004
INSERT INTO marketing_events (
  property_id, campaign_id, event_type, event_date, phone_number,
  message_status, source_platform
) SELECT
  p.id, c.id, 'message_sent', now() - interval '12 days', '830-555-0003',
  'delivered', 'smartercontact'
FROM properties p, campaigns c
WHERE p.internal_id = 'TX-BX-004' AND c.name LIKE 'Bexar%';

INSERT INTO marketing_events (
  property_id, campaign_id, event_type, event_date, phone_number,
  message_status, source_platform
) SELECT
  p.id, c.id, 'message_sent', now() - interval '9 days', '830-555-0003',
  'delivered', 'smartercontact'
FROM properties p, campaigns c
WHERE p.internal_id = 'TX-BX-004' AND c.name LIKE 'Bexar%';

-- ============================================================================
-- SAMPLE FOLLOW-UP TASKS
-- ============================================================================

-- Follow-ups for contacted properties
INSERT INTO follow_up_tasks (
  property_id, follow_up_stage, status, next_contact_date, assigned_to, notes
) SELECT
  id, 2, 'due', now() + interval '2 days', 'a0000000-0000-0000-0000-000000000002'::uuid,
  'Ready for second contact attempt'
FROM properties
WHERE internal_id IN ('TX-BX-002', 'TX-BX-003', 'TX-BX-004');

-- ============================================================================
-- SAMPLE OPT-OUTS
-- ============================================================================

-- (No opt-outs in seed data - these are added during campaigns)

-- ============================================================================
-- SAMPLE ACTIVITY LOGS
-- ============================================================================

INSERT INTO activity_logs (
  user_id, action, entity_type, entity_id, after_values, source, status
) VALUES
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'import_data', 'properties',
   'TX_Bexar_10yr_2-200ac_Nov2026_1769',
   '{"record_count": 1769, "new_properties": 1769}'::jsonb,
   'web', 'success'),

  ('a0000000-0000-0000-0000-000000000001'::uuid, 'import_data', 'properties',
   'FL_Broward_5yr_0.5-50ac_Nov2026_892',
   '{"record_count": 892, "new_properties": 892}'::jsonb,
   'web', 'success'),

  ('a0000000-0000-0000-0000-000000000002'::uuid, 'campaign_created', 'campaigns',
   'bexar-wave-1',
   '{"campaign_name": "Bexar County Land Owners - Wave 1"}'::jsonb,
   'web', 'success');

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Sample data loaded: 2026-11-20
-- Properties: 8 sample records (TX, FL, NC)
-- Campaigns: 2 active campaigns
-- Marketing events: 5 contact events
-- Follow-ups: 3 scheduled
-- Ready for testing and development
