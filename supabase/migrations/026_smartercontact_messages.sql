-- NextCrest migration 026
-- Inbox conversation messages, copied in by the sync (npm run sync:smartercontact -- --inbox-messages=N).
-- Stores the text and the details shown in the thread: direction, time, the campaign source and the numbers
-- used. Attachment links are not stored, because SmarterContact expires them after a week.
-- Signed-in users can read the table. Only the server (service role) writes to it.

BEGIN;

CREATE TABLE IF NOT EXISTS smartercontact_messages (
  message_id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  type TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT,
  source TEXT,
  from_number TEXT,
  to_number TEXT,
  attachment_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sc_messages_contact ON smartercontact_messages (contact_id, created_at);

ALTER TABLE smartercontact_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY smartercontact_messages_read ON smartercontact_messages
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT ON smartercontact_messages TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
