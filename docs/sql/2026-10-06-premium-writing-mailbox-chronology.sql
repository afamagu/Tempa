-- ============================================================
-- TEMPA — PREMIUM WRITING/READING UX: MAILBOX ARRIVAL CHRONOLOGY
-- PREPARED 2026-10-06. FORWARD-ONLY.
--
-- Maya's live pilot report exposed a real Mail Call chronology defect:
-- an incoming letter created earlier but delivered later could appear below
-- a letter the recipient wrote in the meantime, because every mailbox
-- surface sorted by created_at.
--
-- mailbox_at is VIEWER-SPECIFIC:
--   sender    -> created_at (their own sent mail is visible immediately)
--   recipient -> deliver_at (incoming mail joins their mailbox on arrival)
--
-- This never changes or replaces the canonical letters_for_participant view.
-- It creates a mailbox-only sibling with the exact same delivery predicate.
-- A future incoming row remains completely absent until deliver_at <= now().
-- ============================================================

begin;

create or replace view public.mailbox_letters_for_participant
with (
  security_barrier = true
)
as
select
  l.id,
  l.sender_id,
  l.recipient_id,
  l.question_answer_id,
  l.reply_to_id,
  l.body,
  l.status,
  l.created_at,
  l.expires_at,
  l.replied_at,
  l.closed_at,
  l.closed_by,
  l.close_reason,

  (
    l.recipient_id = auth.uid()
    and l.opened_at is null
  ) as is_unread,

  l.correspondence_id,

  case
    when l.sender_id = auth.uid() then l.created_at
    else l.deliver_at
  end as mailbox_at

from public.letters l

where
  auth.uid() = l.sender_id
  or (
    auth.uid() = l.recipient_id
    and l.deliver_at <= now()
  );

revoke all on public.mailbox_letters_for_participant from public, anon;
grant select on public.mailbox_letters_for_participant to authenticated;

comment on column public.mailbox_letters_for_participant.mailbox_at is
  'Viewer-specific mailbox chronology: sender sees created_at; recipient sees actual arrival deliver_at. Never exposes future delivery timing.';

commit;


-- ============================================================
-- READ-ONLY VERIFICATION — EVERY BOOLEAN SHOULD BE TRUE
-- ============================================================

select
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mailbox_letters_for_participant'
      and column_name = 'mailbox_at'
  ) as mailbox_at_exposed,

  position(
    'CASE'
    in upper(pg_get_viewdef('public.mailbox_letters_for_participant'::regclass, true))
  ) > 0
  and position(
    'deliver_at'
    in pg_get_viewdef('public.mailbox_letters_for_participant'::regclass, true)
  ) > 0
    as mailbox_at_uses_delivery_time,

  position(
    'deliver_at <= now()'
    in pg_get_viewdef('public.mailbox_letters_for_participant'::regclass, true)
  ) > 0
    as recipient_delivery_gate_preserved,

  position(
    'opened_at'
    in pg_get_viewdef('public.mailbox_letters_for_participant'::regclass, true)
  ) > 0
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'letters_for_participant'
      and column_name = 'opened_at'
  )
    as raw_opened_at_still_hidden,

  has_table_privilege(
    'authenticated',
    'public.mailbox_letters_for_participant',
    'SELECT'
  ) as authenticated_can_read_safe_view,

  to_regclass('public.letters_for_participant') is not null
    as canonical_letter_view_untouched;
