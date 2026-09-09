-- Tempa — read-only diagnostic for "a letter's header shows the wrong
-- sender/recipient direction."
-- PREPARED 2026-09-02. NOT EXECUTED. Pure SELECT — no CREATE / ALTER /
-- DROP / INSERT / UPDATE / DELETE. Nothing here writes to the database
-- or infers/corrects anything; it only surfaces rows for a human to
-- read, the same way the screenshot bug report itself was found (by a
-- person reading a salutation/signature against the rendered header).
--
-- ============================================================
-- WHY THIS QUERY EXISTS, NOT A CORRECTION SCRIPT
-- ============================================================
--
-- Investigation confirmed, by reading the actual SQL, that no genuine
-- end-user action — past or present — could have produced a letters
-- row with sender_id/recipient_id reversed:
--
--   - public.letters itself carries `revoke all ... from public, anon,
--     authenticated` (docs/sql/2026-08-30-letters.sql) and has never
--     been re-granted since (checked every later migration that
--     touches grants on this table). No authenticated app user, and no
--     bug in the app's own TypeScript, can INSERT or UPDATE this table
--     directly, ever.
--   - The only two paths that can ever create a row are the
--     SECURITY DEFINER functions send_first_letter and
--     reply_to_letter. Every revision of both — the original in
--     2026-08-30-letters.sql, the correspondence_id-aware rewrite in
--     2026-08-31-correspondences.sql, and reply_to_letter's later
--     rewrites in 2026-08-31-moments.sql and
--     2026-09-01-letter2-moments-gate-fix.sql — was read directly and
--     assigns identically:
--       send_first_letter:  sender_id = auth.uid(), recipient_id = p_recipient_id
--       reply_to_letter:    sender_id = auth.uid(), recipient_id = original.sender_id
--                            (gated by original.recipient_id = auth.uid(),
--                             i.e. only the letter's real recipient may
--                             reply to it)
--     auth.uid() is the database's own notion of who is actually
--     authenticated for this request — the client cannot pass a
--     different sender_id in, at any point in this app's history.
--   - The read path (letters_for_participant view,
--     lib/letters.ts's toLetter(), resolveLetterDirection()) is a
--     straight, unmodified pass-through of sender_id/recipient_id,
--     confirmed by direct read and by lib/letters.test.ts's
--     creation-through-display tests.
--
-- Given that, a row with backwards sender_id/recipient_id can only
-- exist if it was written some way that bypasses RLS/grants
-- entirely — e.g. directly through the Supabase Table Editor / SQL
-- Editor (which typically runs as postgres/service_role and ignores
-- RLS), most plausibly while hand-seeding test/historical conversation
-- data for two real test accounts. There is no column anywhere in this
-- schema recording how a row was created, so there is no structural
-- signal that distinguishes a "really backwards" row from a normal
-- one — nothing here can safely auto-correct anything. Body text
-- (salutations/signatures) is legible evidence for a human, but is
-- explicitly NOT used as a correction signal by this query, and must
-- not become one in an automated script: it's unstructured, written by
-- members, and never a reliable machine-readable source of truth.
--
-- ============================================================
-- WHAT TO DO WITH THE RESULTS
-- ============================================================
--
-- For each row, read `body` against `sender_pseudonym`/
-- `recipient_pseudonym` the same way the original screenshot bug was
-- found: does the salutation/signature match who's listed as sender
-- and recipient? Flag anything that looks backwards for a HUMAN with
-- direct knowledge of that conversation to confirm, then correct that
-- specific row by hand (a plain UPDATE swapping sender_id and
-- recipient_id for that one id) — never as a bulk/pattern-matched
-- script. This query only surfaces candidates; it does not decide
-- anything.

select
  l.id                  as letter_id,
  l.correspondence_id,
  l.created_at,
  l.sender_id,
  sender.pseudonym      as sender_pseudonym,
  l.recipient_id,
  recipient.pseudonym   as recipient_pseudonym,
  l.body,
  l.reply_to_id         as reply_to_letter_id

from public.letters l

join public.profiles sender
  on sender.id = l.sender_id

join public.profiles recipient
  on recipient.id = l.recipient_id

order by l.correspondence_id, l.created_at asc;
