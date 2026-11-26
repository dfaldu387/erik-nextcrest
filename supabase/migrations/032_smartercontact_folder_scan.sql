-- NextCrest migration 032
-- Resumable folder scans for the SmarterContact inbox folders that are too big to list in one cycle (Unreplied,
-- Awaiting reply). The sync reads a few pages a minute and records which conversations it has seen in the folder;
-- when a scan finishes, conversations that were not seen have the folder removed.
--
--   sc_folder_seen       one row per conversation per folder: when a scan last saw it there.
--   sc_mark_folder       adds the folder to the listed conversations (in one statement) and records they were seen.
--   sc_finish_folder     removes the folder from conversations that the finished scan did not see, then clears the
--                        seen rows of older scans.

BEGIN;

CREATE TABLE IF NOT EXISTS sc_folder_seen (
  folder TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY (folder, contact_id)
);
ALTER TABLE sc_folder_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sc_folder_seen FROM anon, authenticated;

CREATE OR REPLACE FUNCTION sc_mark_folder(p_folder TEXT, p_ids TEXT[], p_seen TIMESTAMP WITH TIME ZONE)
RETURNS INT
LANGUAGE sql
AS $$
  WITH seen AS (
    INSERT INTO sc_folder_seen (folder, contact_id, seen_at)
    SELECT p_folder, unnest(p_ids), p_seen
    ON CONFLICT (folder, contact_id) DO UPDATE SET seen_at = EXCLUDED.seen_at
    RETURNING 1
  ),
  added AS (
    UPDATE smartercontact_conversations c
    SET folders = array_append(c.folders, p_folder)
    WHERE c.contact_id = ANY(p_ids) AND NOT (p_folder = ANY(c.folders))
    RETURNING 1
  )
  SELECT (SELECT count(*)::int FROM added);
$$;

CREATE OR REPLACE FUNCTION sc_finish_folder(p_folder TEXT, p_seen TIMESTAMP WITH TIME ZONE)
RETURNS INT
LANGUAGE sql
AS $$
  WITH removed AS (
    UPDATE smartercontact_conversations c
    SET folders = array_remove(c.folders, p_folder)
    WHERE p_folder = ANY(c.folders)
      AND NOT EXISTS (
        SELECT 1 FROM sc_folder_seen s
        WHERE s.folder = p_folder AND s.contact_id = c.contact_id AND s.seen_at >= p_seen
      )
    RETURNING 1
  ),
  cleared AS (
    DELETE FROM sc_folder_seen WHERE folder = p_folder AND seen_at < p_seen
    RETURNING 1
  )
  SELECT (SELECT count(*)::int FROM removed);
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
