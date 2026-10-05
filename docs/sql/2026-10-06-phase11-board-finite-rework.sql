-- ============================================================
-- TEMPA — PHASE 11: FINITE BOARD + DISPATCH LETTER ORIGIN
-- PREPARED 2026-10-06. FORWARD-ONLY.
--
-- The finite Board itself needs no new ranking table or persisted session:
-- it reuses board_feed_page and existing encounter ledgers.
--
-- This migration adds only the durable first-contact context required when
-- a private Letter begins from a member Dispatch.
--
-- Invariants:
-- * the genuine Question answer remains the existing Safety/eligibility anchor;
-- * the Dispatch is separate immutable invitation/context metadata;
-- * send_first_letter remains the authority for Safety, capacity, blocks,
--   duplicate-contact rules and correspondence creation;
-- * only a currently published, visible MEMBER Dispatch by the intended
--   recipient can be used as Dispatch context;
-- * Stop Letters may prevent the private Letter while leaving public Board
--   reading alone; full blocks remain absolute;
-- * private Letters gain no sharing behavior.
-- ============================================================

begin;

-- ============================================================
-- 1. IMMUTABLE DISPATCH-ORIGIN SNAPSHOT
-- ============================================================

create table if not exists public.dispatch_letter_contexts (
  letter_id uuid primary key
    references public.letters(id) on delete cascade,

  -- Nullable on deletion: the historical Letter keeps its title snapshot even
  -- if the public Dispatch later disappears.
  dispatch_id uuid
    references public.dispatches(id) on delete set null,

  title_snapshot text not null,

  created_at timestamptz not null default now()
);

alter table public.dispatch_letter_contexts enable row level security;

drop policy if exists dispatch_letter_context_read
  on public.dispatch_letter_contexts;

create policy dispatch_letter_context_read
  on public.dispatch_letter_contexts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.letters_for_participant l
      where l.id = letter_id
    )
  );

revoke all
  on public.dispatch_letter_contexts
  from public, anon, authenticated;

grant select
  on public.dispatch_letter_contexts
  to authenticated;


-- ============================================================
-- 2. DISPATCH-SPECIFIC FIRST-CONTACT WRAPPER
-- ============================================================
--
-- This deliberately CALLS the installed send_first_letter function instead
-- of reproducing it. That means every current/future Safety, capacity,
-- pending/active lifecycle and duplicate guard stays centralized.
--
-- PL/pgSQL function calls are transactional: if the context INSERT below
-- fails, the Letter, correspondence mutation and Safety consumption performed
-- by send_first_letter roll back with it.
-- ============================================================

create or replace function public.send_first_letter_from_dispatch(
  p_recipient_id uuid,
  p_dispatch_id uuid,
  p_question_answer_id uuid,
  p_body text,
  p_safety_evaluation_id uuid,
  p_warning_acknowledged boolean default false
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path = 'pg_catalog'
as $function$
declare
  v_dispatch public.dispatches%rowtype;
  v_result public.letters_for_participant;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.'
      using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses ordinary Dispatch RLS, so reproduce the exact
  -- public-content conditions explicitly here. is_blocked_pair is the
  -- everywhere/full-block boundary; the narrower Stop Letters decision is
  -- intentionally left to send_first_letter's correspondence block check.
  select d.*
  into v_dispatch
  from public.dispatches d
  where d.id = p_dispatch_id
    and d.author_id = p_recipient_id
    and d.status = 'published'
    and d.moderation_status = 'visible'
    and coalesce(d.published_as, 'member') = 'member'
    and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)
    and tempa_private.author_content_publicly_visible(d.author_id)
  for share;

  if not found then
    raise exception 'This Dispatch is no longer available.'
      using errcode = 'P0002';
  end if;

  -- The genuine Question answer remains the existing first-contact eligibility
  -- and Safety context. The Dispatch is separate invitation metadata, never a
  -- fake Question answer and never a replacement for Safety evaluation.
  v_result := public.send_first_letter(
    p_recipient_id,
    p_question_answer_id,
    p_body,
    p_safety_evaluation_id,
    p_warning_acknowledged
  );

  insert into public.dispatch_letter_contexts (
    letter_id,
    dispatch_id,
    title_snapshot
  )
  values (
    v_result.id,
    v_dispatch.id,
    v_dispatch.title
  );

  return v_result;
end;
$function$;

revoke all on function public.send_first_letter_from_dispatch(
  uuid, uuid, uuid, text, uuid, boolean
) from public, anon;

grant execute on function public.send_first_letter_from_dispatch(
  uuid, uuid, uuid, text, uuid, boolean
) to authenticated;

commit;


-- ============================================================
-- READ-ONLY VERIFICATION — EVERY BOOLEAN SHOULD BE TRUE
-- ============================================================

select
  to_regclass('public.dispatch_letter_contexts') is not null
    as dispatch_context_table_ready,

  to_regprocedure(
    'public.send_first_letter_from_dispatch(uuid,uuid,uuid,text,uuid,boolean)'
  ) is not null
    as dispatch_first_letter_rpc_ready,

  has_table_privilege(
    'authenticated',
    'public.dispatch_letter_contexts',
    'SELECT'
  )
    as participants_can_read_context,

  not has_table_privilege(
    'authenticated',
    'public.dispatch_letter_contexts',
    'INSERT'
  )
    as members_cannot_forge_context,

  not has_table_privilege(
    'anon',
    'public.dispatch_letter_contexts',
    'SELECT'
  )
    as anon_cannot_read_context,

  position(
    'public.send_first_letter('
    in pg_get_functiondef(
      'public.send_first_letter_from_dispatch(uuid,uuid,uuid,text,uuid,boolean)'::regprocedure
    )
  ) > 0
    as wrapper_reuses_first_letter_authority,

  position(
    'coalesce(d.published_as, ''member'') = ''member'''
    in pg_get_functiondef(
      'public.send_first_letter_from_dispatch(uuid,uuid,uuid,text,uuid,boolean)'::regprocedure
    )
  ) > 0
    as only_member_dispatches_can_anchor,

  position(
    'tempa_private.is_blocked_pair'
    in pg_get_functiondef(
      'public.send_first_letter_from_dispatch(uuid,uuid,uuid,text,uuid,boolean)'::regprocedure
    )
  ) > 0
    as full_block_respected,

  position(
    'tempa_private.author_content_publicly_visible'
    in pg_get_functiondef(
      'public.send_first_letter_from_dispatch(uuid,uuid,uuid,text,uuid,boolean)'::regprocedure
    )
  ) > 0
    as author_visibility_respected;
