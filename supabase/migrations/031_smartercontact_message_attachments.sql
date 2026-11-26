-- NextCrest migration 031
-- Stores each message's attachments from the SmarterContact API: call recordings (audio), voice messages and MMS
-- files. Each entry is { index, content_type, url }. The url is a signed link that SmarterContact expires about a week
-- after the API call that returned it, so the sync re-reads a conversation when someone opens it and the links are
-- renewed. Signed-in users can read the table; only the server writes to it.

BEGIN;

ALTER TABLE smartercontact_messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;

NOTIFY pgrst, 'reload schema';
