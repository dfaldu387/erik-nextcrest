-- NextCrest migration 006
-- Creates the tables that the import, duplicate and marketing features need,
-- and adds the FIPS + APN key that stops the same parcel being imported twice.
-- Idempotent: safe to run more than once.

BEGIN;

-- ============================================================================
-- PROPERTIES: parcel key (county FIPS + normalized APN)
-- ============================================================================

ALTER TABLE properties ADD COLUMN IF NOT EXISTS fips TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS apn_raw TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS apn_normalized TEXT;

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_fips_format;
ALTER TABLE properties ADD CONSTRAINT properties_fips_format
  CHECK (fips IS NULL OR fips ~ '^[0-9]{5}$');

-- A parcel is unique within its county. Two parcels with the same APN in
-- different counties are different parcels, so the key includes FIPS.
CREATE UNIQUE INDEX IF NOT EXISTS properties_parcel_key
  ON properties (fips, apn_normalized)
  WHERE fips IS NOT NULL AND apn_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_properties_apn_normalized ON properties (apn_normalized);

-- ============================================================================
-- DATASETS (rows of a purchased or imported file)
-- ============================================================================

CREATE TABLE IF NOT EXISTS dataset_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  data_purchase_id UUID REFERENCES data_purchases(id) ON DELETE SET NULL,
  import_job_id UUID REFERENCES import_jobs(id) ON DELETE SET NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  row_number INT,
  raw_data JSONB NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'inserted', 'updated', 'skipped', 'duplicate', 'failed', 'review')),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_dataset_records_purchase ON dataset_records (data_purchase_id);
CREATE INDEX IF NOT EXISTS idx_dataset_records_import ON dataset_records (import_job_id);
CREATE INDEX IF NOT EXISTS idx_dataset_records_property ON dataset_records (property_id);

CREATE TABLE IF NOT EXISTS import_job_errors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_number INT,
  error_message TEXT NOT NULL,
  raw_data JSONB
);

CREATE INDEX IF NOT EXISTS idx_import_job_errors_job ON import_job_errors (import_job_id);

CREATE TABLE IF NOT EXISTS import_mapping_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  name TEXT NOT NULL,
  description TEXT,
  source_format TEXT,
  field_mapping JSONB NOT NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_public BOOLEAN NOT NULL DEFAULT false
);

-- ============================================================================
-- DUPLICATE DETECTION
-- ============================================================================

CREATE TABLE IF NOT EXISTS duplicate_candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  property_id_1 UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  property_id_2 UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  match_level INT NOT NULL CHECK (match_level IN (1, 2, 3)),
  match_score NUMERIC(5, 2),
  match_reasons TEXT[],
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  CHECK (property_id_1 <> property_id_2),
  UNIQUE (property_id_1, property_id_2)
);

CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_status ON duplicate_candidates (status);

CREATE TABLE IF NOT EXISTS duplicate_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  duplicate_candidate_id UUID NOT NULL REFERENCES duplicate_candidates(id) ON DELETE CASCADE,
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK (decision IN ('confirmed', 'rejected', 'manual_review')),
  reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT
);

-- No foreign key on source_property_id: a merged record is removed from
-- properties, but its history must remain.
CREATE TABLE IF NOT EXISTS property_merge_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  source_property_id UUID NOT NULL,
  target_property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  merged_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  preserved_data JSONB,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_property_merge_history_target ON property_merge_history (target_property_id);

-- ============================================================================
-- PHONES AND SUPPRESSION
-- ============================================================================

-- phone_number holds the normalized 10-digit US number (see normalizePhone in the app).
CREATE TABLE IF NOT EXISTS phone_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  phone_number TEXT NOT NULL UNIQUE CHECK (phone_number ~ '^[0-9]{10}$'),
  verification_status TEXT,
  is_valid BOOLEAN NOT NULL DEFAULT true,
  last_verified_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS phone_suppressions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  phone_number_id UUID NOT NULL REFERENCES phone_numbers(id) ON DELETE CASCADE,
  suppression_type TEXT NOT NULL CHECK (suppression_type IN ('opt_out', 'wrong_number', 'dnc', 'manual')),
  source TEXT,
  source_event_id UUID,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_phone_suppressions_phone ON phone_suppressions (phone_number_id);

-- ============================================================================
-- CAMPAIGN CONTACTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS campaign_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  phone_number TEXT CHECK (phone_number IS NULL OR phone_number ~ '^[0-9]{10}$'),
  contact_sequence INT,
  UNIQUE (campaign_id, property_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_campaign_contacts_property ON campaign_contacts (property_id);

-- ============================================================================
-- ROW LEVEL SECURITY for the new tables
-- ============================================================================

ALTER TABLE dataset_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_job_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_mapping_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_merge_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_contacts ENABLE ROW LEVEL SECURITY;

-- Read: any signed-in user. Write: data managers, admins and owners.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'dataset_records', 'import_job_errors', 'import_mapping_templates',
    'duplicate_candidates', 'duplicate_reviews', 'property_merge_history',
    'phone_numbers', 'phone_suppressions', 'campaign_contacts'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s read" ON %1$I', t);
    EXECUTE format('CREATE POLICY "%1$s read" ON %1$I FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s write" ON %1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s write" ON %1$I FOR ALL
         USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''owner'', ''admin'', ''data_manager'')))
         WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''owner'', ''admin'', ''data_manager'')))',
      t
    );
  END LOOP;
END $$;

COMMIT;
