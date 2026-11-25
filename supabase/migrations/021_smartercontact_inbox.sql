-- NextCrest migration 021
-- Inbox: the SmarterContact Messenger conversations, copied in by the sync (server/sync, --inbox).
--
-- folders holds the Messenger folders a conversation is in, using SmarterContact's own names:
-- all, unread, missed_calls, unreplied, awaiting_reply, opted_out, deleted.
-- property_id is set when the phone number matches exactly one property (same rule as migration 020).
-- Signed-in users can read the table. Only the server (service role) writes to it.

BEGIN;

CREATE TABLE IF NOT EXISTS smartercontact_conversations (
  contact_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone TEXT CHECK (phone IS NULL OR phone ~ '^[0-9]{10}$'),
  folders TEXT[] NOT NULL DEFAULT '{}',
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sc_conversations_folders ON smartercontact_conversations USING GIN (folders);
CREATE INDEX IF NOT EXISTS idx_sc_conversations_phone ON smartercontact_conversations (phone);
CREATE INDEX IF NOT EXISTS idx_sc_conversations_name ON smartercontact_conversations (lower(name));

ALTER TABLE smartercontact_conversations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY smartercontact_conversations_read ON smartercontact_conversations
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT ON smartercontact_conversations TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
