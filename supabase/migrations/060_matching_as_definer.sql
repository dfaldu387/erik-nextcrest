-- NextCrest migration 060
-- The matching functions run with the database's permissions (SECURITY DEFINER), not the caller's.
--
-- Why: after a property import, the app calls sc_match_conversations() and sc_mark_responders() as the signed-in user.
-- Those users cannot write sc_conversation_properties or the conversation flags, so the step failed with
-- "new row violates row-level security policy". Only the background sync could run it before.
-- The functions only recompute links from data already in the database, so running them with owner rights is safe.

BEGIN;

ALTER FUNCTION sc_match_conversations() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION sc_mark_responders() SECURITY DEFINER SET search_path = public;

COMMIT;

NOTIFY pgrst, 'reload schema';
