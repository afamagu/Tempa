-- Tempa — Mail Call: "Mail on the way" transit-existence indicator.
-- PREPARED 2026-09-04. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- Revised product rule: a recipient MAY know an incoming delayed
-- letter exists while it is travelling. They still may not access its
-- contents, or anything derived from its contents, before deliver_at.
-- This supersedes the earlier strict existence-hiding rule recorded
-- in an earlier checkpoint.
--
-- letters_for_participant is UNCHANGED by this migration — it remains
-- the enforced content/delivery boundary and continues to hide the
-- incoming row entirely pre-delivery. This is a separate, deliberately
-- narrow, additive surface for existence only.
--
-- One function serves both surfaces that need this (Home: "do I have
-- any incoming mail in transit at all", Letterbox Level 1: "which of
-- my visible correspondents have mail in transit toward me") — a
-- single batched read per page load, never one query per person.
--
-- Returns only two ids per row: which correspondence, and who the
-- other participant is (needed only so the UI can attach the
-- indicator to the right person's card, per the product decision).
-- Never the letter id (no clickable/constructible target), never
-- deliver_at (no countdown), never body/status/opened_at/reply_to_id
-- (no content, no read state, no way to infer content).

begin;

create or replace function public.incoming_mail_in_transit()
returns table (
  correspondence_id uuid,
  other_participant_id uuid
)
language sql
security definer
set search_path to 'pg_catalog'
stable
as $function$
  -- Explicit authentication guard, not merely relying on
  -- recipient_id = auth.uid() to no-op against a null caller (which
  -- would happen to work here since no row ever has a null
  -- recipient_id, but that's an incidental consequence of the schema,
  -- not a stated guard) — an unauthenticated caller gets an empty set,
  -- structurally, the same fail-closed shape as every other read-only
  -- helper in this migration set.
  select distinct
    l.correspondence_id,
    l.sender_id as other_participant_id
  from public.letters l
  where auth.uid() is not null
    and l.recipient_id = auth.uid()
    and l.deliver_at > now();
$function$;

revoke all
on function public.incoming_mail_in_transit()
from public;

grant execute
on function public.incoming_mail_in_transit()
to authenticated;

commit;


-- ============================================================
-- VERIFY (optional — read-only; only the fixture-creation calls at the
-- bottom are not. Run after this migration has been executed. I cannot
-- run any of this myself — every placeholder needs a real id
-- substituted in.
-- ============================================================

-- select set_config('request.jwt.claims', json_build_object('sub','<A-uuid>','role','authenticated')::text, true);
-- set local role authenticated;

-- 1. An incoming future letter shows up for its recipient.
-- select * from public.incoming_mail_in_transit();
-- Expect: one row, other_participant_id = the sender.

-- 2. Once that same letter's deliver_at <= now(), it stops appearing —
--    "on the way" only, never "arrived and still flagged."
-- select * from public.incoming_mail_in_transit();
-- Expect: no row for that letter/correspondence any longer.

-- 3. The viewer's OWN outgoing future letter never appears in their
--    own result — this only reports INCOMING mail, keyed on
--    recipient_id = auth.uid(), never sender_id.
-- select set_config('request.jwt.claims', json_build_object('sub','<sender-uuid>','role','authenticated')::text, true);
-- set local role authenticated;
-- select * from public.incoming_mail_in_transit();
-- Expect: no row for a letter this viewer sent, however far in the future its deliver_at is.

-- 4. Two travelling letters from the SAME correspondent produce ONE
--    row (select distinct on correspondence_id/other_participant_id),
--    not two.
-- select count(*) from public.incoming_mail_in_transit()
--   where other_participant_id = '<same-sender-uuid>';
-- Expect: 1, even with two+ in-transit letters from that sender.

-- 5. Travelling letters from two DIFFERENT correspondents mark only
--    those two — never a third, unrelated correspondent.
-- select other_participant_id from public.incoming_mail_in_transit();
-- Expect: exactly the two sender ids with genuinely in-transit mail.

-- 6. Confirms the function's own return shape carries nothing beyond
--    the two ids — no accidental extra column.
select
  p.proname,
  pg_get_function_result(p.oid) as return_shape,
  p.prosecdef,
  p.proconfig
from pg_proc p
where p.proname = 'incoming_mail_in_transit';
-- Expect: return_shape = "TABLE(correspondence_id uuid, other_participant_id uuid)",
-- prosecdef = true, proconfig containing search_path=pg_catalog.

-- 7. Confirms letters_for_participant's own definition is byte-for-
--    byte unchanged by this migration.
select pg_get_viewdef('public.letters_for_participant'::regclass, true) as view_definition;
-- Expect: unchanged — still (auth.uid() = sender_id) OR ((auth.uid() = recipient_id) AND (deliver_at <= now())).
