-- NextCrest migration 042
-- Every non-empty column of the imported file's row, keyed by the file's header (for example "Mail Full Address"),
-- so property details that have no column of their own can still be shown. The main details (address, mailing
-- address, coordinates, land use, values, year built) have their own columns and are filled from the same row.

BEGIN;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS import_fields JSONB;

COMMIT;

NOTIFY pgrst, 'reload schema';
