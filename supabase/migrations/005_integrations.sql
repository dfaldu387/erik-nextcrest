-- NextCrest Integrations & Configuration
-- Database: PostgreSQL (Supabase)
-- Version: 1.0.0
-- Migration: 005
-- Purpose: Setup integration tracking and configuration

-- ============================================================================
-- INTEGRATION CONFIGURATION TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- Integration details
  integration_type TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,

  -- Status
  is_enabled BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'disconnected',

  -- Configuration
  config JSONB,

  -- Credentials (encrypted at application level)
  credentials_encrypted TEXT,

  -- Last sync info
  last_sync_at TIMESTAMP WITH TIME ZONE,
  last_sync_status TEXT,
  last_error TEXT,

  -- Metadata
  sync_direction TEXT,
  sync_frequency INT DEFAULT 3600,

  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);

CREATE INDEX idx_integrations_type ON integrations(integration_type);
CREATE INDEX idx_integrations_enabled ON integrations(is_enabled);
CREATE INDEX idx_integrations_status ON integrations(status);

-- RLS for integrations (only admins)
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can view integrations" ON integrations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

CREATE POLICY "Only admins can manage integrations" ON integrations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

CREATE POLICY "Only admins can update integrations" ON integrations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

-- ============================================================================
-- INTEGRATION SYNC LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS integration_sync_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,

  -- Sync details
  sync_type TEXT,
  direction TEXT,

  -- Results
  status TEXT,
  records_synced INT,
  records_created INT,
  records_updated INT,
  records_failed INT,

  -- Error tracking
  error_message TEXT,
  error_details JSONB,

  -- Performance
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INT,

  -- Metadata
  metadata JSONB
);

CREATE INDEX idx_integration_sync_logs_integration_id ON integration_sync_logs(integration_id);
CREATE INDEX idx_integration_sync_logs_created_at ON integration_sync_logs(created_at);
CREATE INDEX idx_integration_sync_logs_status ON integration_sync_logs(status);

-- RLS for sync logs
ALTER TABLE integration_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view integration sync logs" ON integration_sync_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'data_manager')
    )
  );

-- ============================================================================
-- BUSINESS CONFIGURATION TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS business_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- Configuration keys
  config_key TEXT NOT NULL UNIQUE,
  config_value JSONB,
  description TEXT,

  -- Metadata
  config_type TEXT,
  is_sensitive BOOLEAN DEFAULT false,
  updated_by UUID REFERENCES profiles(id)
);

CREATE INDEX idx_business_config_key ON business_config(config_key);

-- RLS for config
ALTER TABLE business_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can view sensitive config" ON business_config
  FOR SELECT USING (
    is_sensitive = false OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

-- ============================================================================
-- INSERT DEFAULT INTEGRATIONS
-- ============================================================================

INSERT INTO integrations (
  integration_type, name, description, is_enabled, status,
  sync_direction, sync_frequency
) VALUES
  ('smartercontact', 'SmarterContact', 'SMS marketing and campaign management',
   false, 'disconnected', 'bidirectional', 3600),

  ('land_portal', 'Land Portal', 'Property data acquisition and search',
   false, 'disconnected', 'inbound', 86400),

  ('google_drive', 'Google Drive', 'File storage and backup (optional)',
   false, 'disconnected', 'outbound', 86400)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- INSERT DEFAULT BUSINESS CONFIG
-- ============================================================================

INSERT INTO business_config (
  config_key, config_value, description, config_type
) VALUES
  ('follow_up_max_contacts', '3'::jsonb,
   'Maximum contact attempts before 90-day re-marketing', 'followup'),

  ('follow_up_contact_interval', '7'::jsonb,
   'Days between contact attempts', 'followup'),

  ('follow_up_rehit_days', '90'::jsonb,
   'Days before property is eligible for re-marketing', 'followup'),

  ('apn_normalization_rules', '{"remove_separators": true, "preserve_leading_zeros": true}'::jsonb,
   'Rules for normalizing APNs', 'duplicate_detection'),

  ('duplicate_match_threshold', '0.85'::jsonb,
   'Score threshold for flagging potential duplicates', 'duplicate_detection'),

  ('export_exclude_suppressed', 'true'::jsonb,
   'Automatically exclude opt-outs and wrong numbers from exports', 'export'),

  ('csv_formula_injection_prevention', 'true'::jsonb,
   'Escape formula characters in CSV exports', 'export'),

  ('owner_name_parsing', '{"business_keywords": ["LLC", "Inc", "Corp", "Trust", "LP", "LLP", "Co", "Ltd"]}'::jsonb,
   'Rules for detecting business vs individual owners', 'import')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- HELPER VIEWS FOR INTEGRATIONS
-- ============================================================================

-- View: Integration status summary
CREATE OR REPLACE VIEW integration_status_summary AS
SELECT
  integration_type,
  name,
  is_enabled,
  status,
  last_sync_at,
  last_sync_status,
  CASE
    WHEN last_sync_at IS NULL THEN 'Never synced'
    WHEN NOW() - last_sync_at < INTERVAL '1 hour' THEN 'Recently synced'
    WHEN NOW() - last_sync_at < INTERVAL '1 day' THEN 'Synced today'
    ELSE 'Not synced recently'
  END as sync_status,
  last_error
FROM integrations;

-- View: Recent sync logs summary
CREATE OR REPLACE VIEW recent_sync_logs AS
SELECT
  i.integration_type,
  i.name,
  isl.created_at,
  isl.status,
  isl.records_synced,
  isl.records_failed,
  isl.duration_seconds,
  isl.error_message
FROM integration_sync_logs isl
JOIN integrations i ON isl.integration_id = i.id
ORDER BY isl.created_at DESC
LIMIT 50;

-- ============================================================================
-- FUNCTION: Log integration sync
-- ============================================================================

CREATE OR REPLACE FUNCTION log_integration_sync(
  p_integration_id UUID,
  p_sync_type TEXT,
  p_direction TEXT,
  p_status TEXT,
  p_records_synced INT,
  p_error_message TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO integration_sync_logs (
    integration_id, sync_type, direction, status,
    records_synced, error_message, started_at, completed_at
  ) VALUES (
    p_integration_id, p_sync_type, p_direction, p_status,
    p_records_synced, p_error_message, NOW(), NOW()
  )
  RETURNING id INTO v_log_id;

  -- Update integration last sync info
  UPDATE integrations
  SET last_sync_at = NOW(),
      last_sync_status = p_status,
      last_error = p_error_message
  WHERE id = p_integration_id;

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Get configuration value
-- ============================================================================

CREATE OR REPLACE FUNCTION get_config(p_config_key TEXT)
RETURNS JSONB AS $$
DECLARE
  v_value JSONB;
BEGIN
  SELECT config_value INTO v_value
  FROM business_config
  WHERE config_key = p_config_key;

  RETURN COALESCE(v_value, 'null'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Integration tables created: 2
-- Configuration tables created: 1
-- Views created: 2
-- Functions created: 2
-- Default integrations: 3
-- Default configurations: 8
-- Ready for integration implementation
