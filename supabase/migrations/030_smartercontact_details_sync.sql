-- NextCrest migration 030
-- Tracks when each conversation's last message (date and text) was read from SmarterContact, so the cloud sync can
-- fill in conversations that were never read. A conversation with no messages is still stamped, so it is not retried
-- every cycle.

BEGIN;

ALTER TABLE smartercontact_conversations ADD COLUMN IF NOT EXISTS details_synced_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_sc_conversations_details_synced ON smartercontact_conversations (details_synced_at NULLS FIRST);

COMMIT;

NOTIFY pgrst, 'reload schema';
