-- NextCrest migration 022
-- Inbox details: the latest message, its time and direction, and the contact's labels, as shown in the
-- SmarterContact Messenger list. Filled by the sync (npm run sync:smartercontact -- --inbox-details=N) for the
-- most recent conversations. Conversations without details show empty columns until they are synced.

BEGIN;

ALTER TABLE smartercontact_conversations ADD COLUMN IF NOT EXISTS last_message TEXT;
ALTER TABLE smartercontact_conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE smartercontact_conversations ADD COLUMN IF NOT EXISTS last_direction TEXT;
ALTER TABLE smartercontact_conversations ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE smartercontact_conversations ADD COLUMN IF NOT EXISTS details_synced_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_sc_conversations_last_message_at ON smartercontact_conversations (last_message_at DESC NULLS LAST);

COMMIT;

NOTIFY pgrst, 'reload schema';
