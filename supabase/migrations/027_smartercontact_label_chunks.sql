-- NextCrest migration 027
-- Labels are synced in chunks: each run labels the next batch of conversations that have not been labelled yet
-- (or were labelled long ago). labels_synced_at records when each conversation's labels were last read.

BEGIN;

ALTER TABLE smartercontact_conversations ADD COLUMN IF NOT EXISTS labels_synced_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_sc_conversations_labels_synced ON smartercontact_conversations (labels_synced_at NULLS FIRST);

COMMIT;

NOTIFY pgrst, 'reload schema';
