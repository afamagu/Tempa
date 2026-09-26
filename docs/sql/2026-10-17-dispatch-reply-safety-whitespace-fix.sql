-- ============================================================
-- TEMPA — DISPATCH REPLY: SAFETY FINGERPRINT / WHITESPACE FIX
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- then run 2026-10-17-dispatch-reply-safety-whitespace-fix-verify.sql
-- (read-only; overall_pass must be true).
-- Forward-only. Does NOT edit 2026-10-06-safety-checkpoint4-public-
-- surfaces.sql. Same signature, same grants — no app deploy needed.
-- ============================================================
--
-- DEFECT (live in production, confirmed by the 2026-09-26 read-only
-- audit): /api/safety/evaluate -> record_safety_evaluation fingerprints
-- the Reply body EXACTLY as submitted. create_reply (2026-10-06) trims it
-- first (v_body := trim(both from coalesce(p_body, ''))) and then passed
-- the TRIMMED v_body to tempa_private.consume_safety_evaluation. Any
-- Reply with a leading/trailing ordinary space therefore failed the
-- fingerprint check with 22023 "This content has changed since it was
-- last checked", which members see as "Could not post this Reply. Please
-- try again." — every retry failed the same way.
--
-- FIX (one argument): consume_safety_evaluation now receives p_body —
-- the exact text that was screened. Everything else is the 2026-10-06
-- definition verbatim:
--   * validation (empty / 500-character) and STORAGE still use the
--     trimmed v_body;
--   * authentication, current_account_status gate, Dispatch existence /
--     published / visible checks, full-scope blocking both ways, author
--     visibility, nested-parent validation, root_reply_id,
--     reply_to_user_id — unchanged;
--   * Safety binding — surface 'dispatch_reply', context = Dispatch,
--     secondary context = parent Reply, warning acknowledgement,
--     single-use consumption, expiry — all enforced inside
--     consume_safety_evaluation, unchanged;
--   * no fallback: an evaluation for different text, a different
--     Dispatch or a different parent is still rejected.
--
-- The latest live create_reply is the 2026-10-06 definition: no later
-- migration on main redefines it (2026-10-12 only replaced
-- consume_safety_evaluation, keeping its 12-argument signature).

begin;

create or replace function public.create_reply(
  p_dispatch_id uuid,
  p_body text,
  p_safety_evaluation_id uuid,
  p_parent_reply_id uuid default null,
  p_warning_acknowledged boolean default false
)
returns public.dispatch_replies
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  v_body text;
  v_dispatch record;
  v_parent record;
  v_root_reply_id uuid;
  v_reply_to_user_id uuid;
  v_new_id uuid;
  v_result public.dispatch_replies%rowtype;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  v_body := trim(both from coalesce(p_body, ''));
  if char_length(v_body) = 0 then
    raise exception 'A Reply needs some writing.';
  end if;
  if char_length(v_body) > 500 then
    raise exception 'Reply is too long.';
  end if;

  select id, author_id, status, moderation_status
  into v_dispatch
  from public.dispatches
  where id = p_dispatch_id
  for share;

  if v_dispatch.id is null then
    raise exception 'Dispatch not found.';
  end if;

  if v_dispatch.status <> 'published' or v_dispatch.moderation_status <> 'visible' then
    raise exception 'This Dispatch is not open to Replies right now.';
  end if;

  if tempa_private.is_blocked_pair(auth.uid(), v_dispatch.author_id)
     or not tempa_private.author_content_publicly_visible(v_dispatch.author_id) then
    raise exception 'This action is not available right now.';
  end if;

  if p_parent_reply_id is null then
    v_root_reply_id := null;
    v_reply_to_user_id := null;
  else

    select id, dispatch_id, author_id, root_reply_id, moderation_status, deleted_at
    into v_parent
    from public.dispatch_replies
    where id = p_parent_reply_id
    for share;

    if v_parent.id is null then
      raise exception 'The Reply you are answering no longer exists.';
    end if;

    if v_parent.dispatch_id <> p_dispatch_id then
      raise exception 'That Reply does not belong to this Dispatch.';
    end if;

    if v_parent.moderation_status <> 'visible' or v_parent.deleted_at is not null then
      raise exception 'That Reply is no longer available to answer.';
    end if;

    if tempa_private.is_blocked_pair(auth.uid(), v_parent.author_id)
       or not tempa_private.author_content_publicly_visible(v_parent.author_id) then
      raise exception 'This action is not available right now.';
    end if;

    v_reply_to_user_id := v_parent.author_id;
    v_root_reply_id := coalesce(v_parent.root_reply_id, v_parent.id);

  end if;

  v_new_id := pg_catalog.gen_random_uuid();

  -- Checkpoint 4 — the one trusted consumption path. context_id is the
  -- Dispatch; secondary_context_id is the optional parent Reply. Placed
  -- after every eligibility check above, strictly before the actual
  -- insert below. 2026-10-17: the Safety fingerprint is bound to the
  -- exact submitted text (p_body), never the trimmed copy stored below.
  perform tempa_private.consume_safety_evaluation(
    p_safety_evaluation_id,
    auth.uid(),
    'dispatch_reply',
    p_dispatch_id,
    null,
    p_parent_reply_id,
    null,
    null,
    null,
    p_body,
    p_warning_acknowledged,
    v_new_id
  );

  insert into public.dispatch_replies (
    id, dispatch_id, author_id, body, parent_reply_id, root_reply_id, reply_to_user_id
  ) values (
    v_new_id, p_dispatch_id, auth.uid(), v_body, p_parent_reply_id, v_root_reply_id, v_reply_to_user_id
  )
  returning * into v_result;

  return v_result;

end;
$function$;

revoke all on function public.create_reply(uuid, text, uuid, uuid, boolean) from public;
grant execute on function public.create_reply(uuid, text, uuid, uuid, boolean) to authenticated;

commit;
