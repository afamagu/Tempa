-- Tempa — fix moments_select_participant: it references a table
-- `authenticated` has no grant on, so every SELECT on public.moments
-- has been failing permission-denied since this policy was created.
-- PREPARED 2026-09-02. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- LIVE ERROR (confirmed via server logs on real authenticated requests,
-- every single time public.moments is queried):
--   "permission denied for table letters", code 42501
--
-- ROOT CAUSE: the live policy (docs/sql/2026-08-31-moments.sql) is
--
--   create policy moments_select_participant
--     on public.moments
--     for select
--     using (
--       exists (
--         select 1
--         from public.letters l
--         where l.id = moments.letter_id
--           and (l.sender_id = auth.uid() or l.recipient_id = auth.uid())
--       )
--     );
--
-- Its USING clause queries public.letters directly. But public.letters
-- itself carries `revoke all ... from public, anon, authenticated`
-- (docs/sql/2026-08-30-letters.sql) — every ordinary read is supposed to
-- go through public.letters_for_participant instead. That view works
-- today only because a plain Postgres view runs with the VIEW OWNER's
-- privileges against its own underlying tables (definer-like behavior),
-- while access to the view itself is governed by its own grant
-- (`grant select on letters_for_participant to authenticated`). An RLS
-- policy's USING clause gets no such protection: it's evaluated under
-- the QUERYING role's own privileges. `authenticated` has zero grant on
-- public.letters, so this subquery has failed outright, for every user,
-- on every single query to public.moments, since the policy was
-- created — completely independent of sender/recipient identity or
-- photo-consent state. This is why Moments have never rendered for
-- anyone: not the sender's own photos, not a locked placeholder for the
-- recipient, nothing — the query itself never returned a row.
--
-- FIX: check participancy through letters_for_participant instead of
-- letters. The view is already grant-select-able by authenticated, and
-- its own WHERE clause (`auth.uid() = sender_id or auth.uid() =
-- recipient_id`) already IS the exact participancy check this policy
-- needs — so simply confirming a matching row exists there is
-- sufficient; there's no need to repeat the sender_id/recipient_id
-- comparison a second time.
--
-- This changes ONLY this one policy. No grants, no other table, no
-- application code, no consent state machine, no Moment
-- serialization/position logic.

drop policy if exists moments_select_participant on public.moments;

create policy moments_select_participant
  on public.moments
  for select
  using (
    exists (
      select 1
      from public.letters_for_participant lp
      where lp.id = moments.letter_id
    )
  );
