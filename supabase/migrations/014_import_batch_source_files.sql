-- NextCrest migration 014
-- Keeps the uploaded files with each import batch so they can be downloaded later.
-- Batches imported before this migration have has_source_file = false and no file to download.
-- Idempotent: safe to run more than once.

BEGIN;

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS has_source_file BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS source_files JSONB;

COMMIT;
