-- NextCrest Initial Schema
-- Database: PostgreSQL (Supabase)
-- Version: 1.0.0
-- Created: 2026-11-20

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search

-- ============================================================================
-- USER & AUTHENTICATION
-- ============================================================================

-- profiles table (references auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_role ON profiles(role);

-- ============================================================================
-- PROPERTY DATABASE
-- ============================================================================

-- properties table (master property database)
CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- Identification
  internal_id TEXT UNIQUE NOT NULL,
  source TEXT NOT NULL,
  original_source_id TEXT,

  -- Location
  state TEXT NOT NULL,
  county TEXT,
  city TEXT,
  zip_code TEXT,
  address TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),

  -- Property Details
  acreage DECIMAL(12, 4),
  property_type TEXT,
  land_use TEXT,
  zoning TEXT,
  property_status TEXT,
  legal_description TEXT,
  assessed_value BIGINT,
  market_value BIGINT,
  year_built INT,

  -- Owner Information
  owner_name TEXT,
  owner_type TEXT,
  mailing_address TEXT,
  mailing_city TEXT,
  mailing_state TEXT,
  mailing_zip TEXT,

  -- Marketing
  total_contacts INT DEFAULT 0,
  last_contacted_at TIMESTAMP WITH TIME ZONE,
  next_contact_eligible_at TIMESTAMP WITH TIME ZONE,
  marketing_status TEXT DEFAULT 'never_contacted',

  -- System
  first_acquired_at TIMESTAMP WITH TIME ZONE,
  last_updated_by_import_at TIMESTAMP WITH TIME ZONE,
  record_quality_score DECIMAL(3, 2)
);

CREATE INDEX idx_properties_state ON properties(state);
CREATE INDEX idx_properties_county ON properties(state, county);
CREATE INDEX idx_properties_zip ON properties(zip_code);
CREATE INDEX idx_properties_internal_id ON properties(internal_id);
CREATE INDEX idx_properties_source ON properties(source);
CREATE INDEX idx_properties_marketing_status ON properties(marketing_status);
CREATE INDEX idx_properties_next_contact ON properties(next_contact_eligible_at);
CREATE INDEX idx_properties_owner_name ON properties USING GIN (to_tsvector('english', COALESCE(owner_name, '')));

-- property_identifiers table (APN/Parcel IDs)
CREATE TABLE IF NOT EXISTS property_identifiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  identifier_type TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  normalized_value TEXT,
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  UNIQUE(property_id, identifier_type, normalized_value)
);

CREATE INDEX idx_property_identifiers_property_id ON property_identifiers(property_id);
CREATE INDEX idx_property_identifiers_normalized ON property_identifiers(normalized_value);
CREATE INDEX idx_property_identifiers_type ON property_identifiers(identifier_type);

-- property_owners table
CREATE TABLE IF NOT EXISTS property_owners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  first_name TEXT,
  last_name TEXT,
  company_name TEXT,
  business_type TEXT,

  phone_numbers TEXT[],
  email_addresses TEXT[],

  owner_sequence INT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_property_owners_property_id ON property_owners(property_id);

-- ============================================================================
-- DATA ACQUISITION
-- ============================================================================

-- data_purchases table
CREATE TABLE IF NOT EXISTS data_purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  dataset_name TEXT NOT NULL UNIQUE,
  source_provider TEXT NOT NULL,

  -- Filters Applied
  filter_states TEXT[],
  filter_counties TEXT[],
  filter_cities TEXT[],
  filter_zips TEXT[],
  acreage_min DECIMAL(12, 4),
  acreage_max DECIMAL(12, 4),
  ownership_duration_years INT,
  custom_filters JSONB,

  -- Results
  original_record_count INT,
  imported_record_count INT,
  duplicate_count INT,
  new_property_count INT,

  -- Metadata
  purchase_date TIMESTAMP WITH TIME ZONE,
  cost DECIMAL(12, 2),
  purchased_by UUID REFERENCES profiles(id),
  import_status TEXT,
  source_file_url TEXT,
  api_acquisition_id TEXT,
  notes TEXT
);

CREATE INDEX idx_data_purchases_dataset_name ON data_purchases(dataset_name);
CREATE INDEX idx_data_purchases_source ON data_purchases(source_provider);
CREATE INDEX idx_data_purchases_purchase_date ON data_purchases(purchase_date);

-- ============================================================================
-- IMPORT MANAGEMENT
-- ============================================================================

-- import_jobs table
CREATE TABLE IF NOT EXISTS import_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  status TEXT NOT NULL,
  source_file_name TEXT,
  source_file_url TEXT,
  data_purchase_id UUID REFERENCES data_purchases(id),

  total_rows INT,
  rows_processed INT,
  rows_inserted INT,
  rows_updated INT,
  rows_skipped INT,
  rows_failed INT,

  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,

  created_by UUID NOT NULL REFERENCES profiles(id),

  field_mapping JSONB NOT NULL,
  import_options JSONB
);

CREATE INDEX idx_import_jobs_status ON import_jobs(status);
CREATE INDEX idx_import_jobs_created_by ON import_jobs(created_by);
CREATE INDEX idx_import_jobs_data_purchase ON import_jobs(data_purchase_id);

-- ============================================================================
-- MARKETING & CAMPAIGNS
-- ============================================================================

-- campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  name TEXT NOT NULL,
  description TEXT,
  source TEXT,
  source_campaign_id TEXT,

  status TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),

  metadata JSONB
);

CREATE INDEX idx_campaigns_source_id ON campaigns(source_campaign_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);

-- marketing_events table (contact history)
CREATE TABLE IF NOT EXISTS marketing_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id),

  event_type TEXT NOT NULL,
  event_date TIMESTAMP WITH TIME ZONE,
  phone_number TEXT,

  message_reference TEXT,
  message_status TEXT,

  source_platform TEXT,
  raw_source_data JSONB,

  processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_marketing_events_property_id ON marketing_events(property_id);
CREATE INDEX idx_marketing_events_campaign_id ON marketing_events(campaign_id);
CREATE INDEX idx_marketing_events_event_type ON marketing_events(event_type);
CREATE INDEX idx_marketing_events_event_date ON marketing_events(event_date);

-- contact_responses table
CREATE TABLE IF NOT EXISTS contact_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  marketing_event_id UUID NOT NULL REFERENCES marketing_events(id),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  response_type TEXT,
  response_message TEXT,
  response_date TIMESTAMP WITH TIME ZONE,

  assigned_to UUID REFERENCES profiles(id),
  status TEXT,
  notes TEXT
);

CREATE INDEX idx_contact_responses_property_id ON contact_responses(property_id);
CREATE INDEX idx_contact_responses_marketing_event_id ON contact_responses(marketing_event_id);

-- ============================================================================
-- SUPPRESSION & EXCLUSIONS
-- ============================================================================

-- opt_outs table
CREATE TABLE IF NOT EXISTS opt_outs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  phone_number TEXT NOT NULL,
  property_id UUID REFERENCES properties(id),

  opt_out_date TIMESTAMP WITH TIME ZONE,
  source TEXT,
  campaign_id UUID REFERENCES campaigns(id),

  reason TEXT,
  original_event_id UUID,

  imported BOOLEAN DEFAULT false,
  imported_by UUID REFERENCES profiles(id)
);

CREATE INDEX idx_opt_outs_phone_number ON opt_outs(phone_number);
CREATE INDEX idx_opt_outs_property_id ON opt_outs(property_id);

-- wrong_numbers table
CREATE TABLE IF NOT EXISTS wrong_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  phone_number TEXT NOT NULL,
  property_id UUID REFERENCES properties(id),

  wrong_number_date TIMESTAMP WITH TIME ZONE,
  source TEXT,
  source_event_id UUID,
  reason TEXT,

  created_by UUID REFERENCES profiles(id),

  corrected_phone_number TEXT,
  corrected_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_wrong_numbers_phone_number ON wrong_numbers(phone_number);
CREATE INDEX idx_wrong_numbers_property_id ON wrong_numbers(property_id);

-- ============================================================================
-- FOLLOW-UP MANAGEMENT
-- ============================================================================

-- follow_up_tasks table
CREATE TABLE IF NOT EXISTS follow_up_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  follow_up_stage INT,
  eligibility_reason TEXT,
  exclusion_reason TEXT,

  next_contact_date TIMESTAMP WITH TIME ZONE,
  last_contact_date TIMESTAMP WITH TIME ZONE,
  contact_count INT,

  status TEXT,
  assigned_to UUID REFERENCES profiles(id),

  notes TEXT,

  UNIQUE(property_id, follow_up_stage)
);

CREATE INDEX idx_follow_up_tasks_property_id ON follow_up_tasks(property_id);
CREATE INDEX idx_follow_up_tasks_next_contact ON follow_up_tasks(next_contact_date);
CREATE INDEX idx_follow_up_tasks_assigned_to ON follow_up_tasks(assigned_to);

-- ============================================================================
-- LISTS & SEGMENTATION
-- ============================================================================

-- saved_lists table
CREATE TABLE IF NOT EXISTS saved_lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  name TEXT NOT NULL,
  description TEXT,

  filters JSONB NOT NULL,

  is_dynamic BOOLEAN DEFAULT true,
  record_count INT,

  created_by UUID NOT NULL REFERENCES profiles(id),

  campaign_history JSONB
);

CREATE INDEX idx_saved_lists_created_by ON saved_lists(created_by);

-- ============================================================================
-- AUDIT & LOGGING
-- ============================================================================

-- activity_logs table
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,

  entity_type TEXT,
  entity_id TEXT,

  before_values JSONB,
  after_values JSONB,

  source TEXT,
  ip_address TEXT,

  status TEXT
);

CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_action ON activity_logs(action);
CREATE INDEX idx_activity_logs_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) - Basic Setup
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE wrong_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Allow users to view their own profile
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Allow authenticated users to view properties (more granular policies in next migration)
CREATE POLICY "Authenticated users can view properties" ON properties
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert properties" ON properties
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================================================
-- UTILITY FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_properties_updated_at BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_import_jobs_updated_at BEFORE UPDATE ON import_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_follow_up_tasks_updated_at BEFORE UPDATE ON follow_up_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_saved_lists_updated_at BEFORE UPDATE ON saved_lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SCHEMA COMPLETE
-- ============================================================================
-- Initial schema created: 2026-11-20
-- Tables: 14
-- Indexes: 50+
-- RLS Policies: Initial setup
-- Next: Run migrations/002_* for advanced RLS and seed data
