-- ============================================================
-- TEMPA — LETTER SEND IDEMPOTENCY (one tap = at most one letter)
-- STATUS: NOT YET APPLIED. For the owner to review and run in the
-- Supabase SQL editor, then run
-- 2026-10-26-letter-send-idempotency-verify.sql and expect
-- overall_pass = true. Apply BEFORE deploying the app change that calls
-- write_letter_once. Forward-only; write_letter itself is NOT changed.
-- ============================================================
--
-- PROBLEM: write_letter had no idempotency. A second Send (double tap,
-- or a retry after a slow/lost response) runs a NEW safety evaluation
-- and inserts a SECOND copy of the same letter.
--
-- FIX: the composer generates one client submission id per letter and
-- calls write_letter_once(p_client_submission_id, <write_letter args>):
--   1. lock the correspondence row (the SAME `for update` lock
--      write_letter itself takes, so concurrent calls serialize);
--   2. if this sender already recorded this submission id, return that
--      letter — nothing is inserted, no evaluation is consumed;
--   3. otherwise call the unchanged public.write_letter (every check,
--      safety consumption and timing rule exactly as before) and record
--      the id. The primary key makes a duplicate impossible even if the
--      lock were ever bypassed.
-- letter_submissions holds only ids: RLS on, no member privilege.

begin;

create table if not exists public.letter_submissions (
  sender_id uuid not null references auth.users(id) on delete cascade,
  client_submission_id uuid not null,
  letter_id uuid not null references public.letters(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sender_id, client_submission_id)
);

alter table public.letter_submissions enable row level security;
revoke all on public.letter_submissions from public, anon, authenticated;

create or replace function public.write_letter_once(
  p_client_submission_id uuid,
  p_correspondence_id uuid,
  p_body text,
  p_safety_evaluation_id uuid,
  p_reply_to_id uuid default null,
  p_moments jsonb default '[]'::jsonb,
  p_postcard jsonb default null,
  p_warning_acknowledged boolean default false
)
returns public.letters_for_participant
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_existing uuid;
  v_result public.letters_for_participant;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if p_client_submission_id is null then
    raise exception 'A submission id is required.';
  end if;

  -- Serialize with any concurrent send on this correspondence (same lock
  -- write_letter takes; re-taking it inside write_letter is a no-op).
  perform 1 from public.correspondences where id = p_correspondence_id for update;

  select s.letter_id into v_existing
  from public.letter_submissions s
  where s.sender_id = auth.uid() and s.client_submission_id = p_client_submission_id;

  if v_existing is not null then
    select * into v_result from public.letters_for_participant where id = v_existing;
    return v_result;
  end if;

  v_result := public.write_letter(
    p_correspondence_id, p_body, p_safety_evaluation_id, p_reply_to_id,
    p_moments, p_postcard, p_warning_acknowledged
  );

  insert into public.letter_submissions (sender_id, client_submission_id, letter_id)
  values (auth.uid(), p_client_submission_id, v_result.id);

  return v_result;
end;
$function$;

revoke all on function public.write_letter_once(uuid, uuid, text, uuid, uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.write_letter_once(uuid, uuid, text, uuid, uuid, jsonb, jsonb, boolean) to authenticated;

commit;
