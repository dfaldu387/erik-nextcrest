-- NextCrest Advanced Row Level Security Policies
-- Database: PostgreSQL (Supabase)
-- Version: 1.0.0
-- Migration: 002
-- Purpose: Implement granular permission-based data access

-- ============================================================================
-- ROW LEVEL SECURITY: PROPERTIES
-- ============================================================================

-- Drop default policy
DROP POLICY IF EXISTS "Authenticated users can view properties" ON properties;
DROP POLICY IF EXISTS "Authenticated users can insert properties" ON properties;

-- Only authenticated users can read properties
CREATE POLICY "Users can view properties" ON properties
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

-- Users can insert properties if they have data_manager role
CREATE POLICY "Data managers can insert properties" ON properties
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'data_manager')
    )
  );

-- Users can update properties if they have data_manager role
CREATE POLICY "Data managers can update properties" ON properties
  FOR UPDATE USING (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'data_manager')
    )
  ) WITH CHECK (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'data_manager')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY: PROPERTY IDENTIFIERS
-- ============================================================================

CREATE POLICY "Users can view property identifiers" ON property_identifiers
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "Data managers can manage property identifiers" ON property_identifiers
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'data_manager')
    )
  );

CREATE POLICY "Data managers can update property identifiers" ON property_identifiers
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'data_manager')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY: PROPERTY OWNERS
-- ============================================================================

CREATE POLICY "Users can view property owners" ON property_owners
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "Data managers can manage property owners" ON property_owners
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'data_manager')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY: DATA PURCHASES
-- ============================================================================

CREATE POLICY "Users can view data purchases" ON data_purchases
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "Data managers can create purchases" ON data_purchases
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'data_manager')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY: IMPORT JOBS
-- ============================================================================

CREATE POLICY "Users can view import jobs" ON import_jobs
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "Data managers can create import jobs" ON import_jobs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'data_manager')
    )
  );

CREATE POLICY "Data managers can update import jobs" ON import_jobs
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'data_manager')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY: CAMPAIGNS
-- ============================================================================

CREATE POLICY "Users can view campaigns" ON campaigns
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "Marketing users can create campaigns" ON campaigns
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'marketing_user', 'data_manager')
    )
  );

CREATE POLICY "Campaign creators can update campaigns" ON campaigns
  FOR UPDATE USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY: MARKETING EVENTS
-- ============================================================================

CREATE POLICY "Users can view marketing events" ON marketing_events
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "Marketing users can record events" ON marketing_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'marketing_user', 'data_manager')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY: CONTACT RESPONSES
-- ============================================================================

CREATE POLICY "Users can view responses" ON contact_responses
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "Marketing users can record responses" ON contact_responses
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'marketing_user')
    )
  );

CREATE POLICY "Assigned users can update responses" ON contact_responses
  FOR UPDATE USING (
    assigned_to = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY: OPT-OUTS
-- ============================================================================

CREATE POLICY "Users can view opt-outs" ON opt_outs
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "Users can record opt-outs" ON opt_outs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'marketing_user', 'data_manager')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY: WRONG NUMBERS
-- ============================================================================

CREATE POLICY "Users can view wrong numbers" ON wrong_numbers
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "Users can record wrong numbers" ON wrong_numbers
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'marketing_user')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY: FOLLOW-UP TASKS
-- ============================================================================

CREATE POLICY "Users can view follow-up tasks" ON follow_up_tasks
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "Team members can view assigned tasks" ON follow_up_tasks
  FOR SELECT USING (
    assigned_to = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

CREATE POLICY "System can create follow-up tasks" ON follow_up_tasks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'data_manager')
    )
  );

CREATE POLICY "Team members can update assigned tasks" ON follow_up_tasks
  FOR UPDATE USING (
    assigned_to = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY: SAVED LISTS
-- ============================================================================

CREATE POLICY "Users can view saved lists" ON saved_lists
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "Users can create lists" ON saved_lists
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
  );

CREATE POLICY "List creators can update their lists" ON saved_lists
  FOR UPDATE USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

-- ============================================================================
-- ROW LEVEL SECURITY: ACTIVITY LOGS
-- ============================================================================

CREATE POLICY "Users can view activity logs" ON activity_logs
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

CREATE POLICY "System can insert activity logs" ON activity_logs
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
  );

-- Activity logs are immutable (no updates/deletes for ordinary users)
CREATE POLICY "Only admins can delete activity logs" ON activity_logs
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  );

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- RLS policies configured: 2026-11-20
-- All tables now have granular permission-based access
-- Next migration: 003_seed_data.sql
