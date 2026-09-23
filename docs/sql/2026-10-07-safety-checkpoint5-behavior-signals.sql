-- ============================================================
-- TEMPA — SAFETY 2, CHECKPOINT 5: BEHAVIORAL / CROSS-CORRESPONDENCE
-- SIGNALS — MUTATION WIRING
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor,
-- AFTER docs/sql/2026-10-03-safety-persistence.sql (this migration
-- calls tempa_private.evaluate_behavior, prepared there in Part 6B) and
-- after every earlier Safety migration. Does NOT merge to main, deploy,
-- or enable enforcement for real members.
-- ============================================================
--
-- Wires public.report_content and public.block_user — real, LIVE,
-- already-shipped production functions — to a durable, POST-EVENT
-- behavioral observation: after a report/block actually commits, check
-- whether the SUBJECT of that report/block (the reported/blocked
-- member, never the reporter/blocker) has crossed the REPORT_SPIKE/
-- BLOCK_SPIKE threshold (tempa_private.behavior_policy, docs/sql/2026-
-- 10-03-safety-persistence.sql). Each is reproduced in FULL from its
-- current live definition (re-read directly immediately before writing
-- this migration — report_content from docs/sql/2026-09-23-dispatch-
-- replies.sql, block_user(uuid, text) from docs/sql/2026-09-24-
-- dispatch-worth-reading.sql), with ONLY the appended behavioral call
-- actually changed — no other line touched, no signature change (this
-- checkpoint needs no new parameter from either function's own caller).
--
-- send_first_letter/write_letter/reply_to_letter/publish_dispatch/
-- update_dispatch/publish_question_answer/create_reply are NOT touched
-- by this migration — their own behavioral coverage (MASS_FIRST_
-- CONTACT, HIGH_CONTACT_VELOCITY, NEAR_DUPLICATE_OUTREACH, ACCOUNT_
-- VELOCITY, REPEATED_SOLICITATION) is already wired into public.
-- record_safety_evaluation itself (docs/sql/2026-10-03-safety-
-- persistence.sql, Part 7), which every one of those mutation RPCs
-- already calls transactionally via tempa_private.consume_safety_
-- evaluation's own predecessor evaluation step — reproducing any of
-- those seven large RPCs a further time here, only to append a call
-- that already effectively runs on their behalf, would be unrelated
-- risk for no behavioral benefit. See this checkpoint's own report for
-- the full "which mutation points get transactional enforcement vs.
-- durable post-event observation" accounting.
--
-- TRANSACTION SAFETY (item 6 — reported explicitly): every behavioral
-- call below is wrapped in its own PL/pgSQL BEGIN/EXCEPTION block. That
-- construct is an implicit subtransaction (savepoint) in Postgres — if
-- tempa_private.evaluate_behavior raises for ANY reason, execution
-- rolls back to that savepoint only, a WARNING is logged, and the real
-- report/block mutation this function exists to perform is completely
-- unaffected: it has already committed its own work earlier in the same
-- function body, and this trailing call can never retroactively fail
-- it. A successful report or block therefore NEVER depends on this
-- analytics write succeeding — exactly the same pattern docs/sql/2026-
-- 10-03-safety-persistence.sql's own record_safety_evaluation now uses
-- for its own trailing evaluate_behavior call. None of the three
-- behavioral checks in this checkpoint (content-volume/velocity/
-- duplicate/account-velocity, repeated-solicitation, report/block spike)
-- are transactional ENFORCEMENT — nothing here can block, deny, or roll
-- back the report/block/Letter itself; every one is a durable POST-EVENT
-- observation, exactly matching item 7's own "may record/escalate,
-- never auto-punish" boundary.

begin;

-- ============================================================
-- 1. REPORT_CONTENT
-- ============================================================
-- Changed from its current live definition: after the report insert
-- succeeds, evaluate_behavior runs a REPORT_SPIKE check against the
-- REPORTED member (v_reported_user_id, resolved earlier in this same
-- function body — never auth.uid(), the reporter).

create or replace function public.report_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_context text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$

declare
  v_reported_user_id uuid;
  v_evidence jsonb;
  v_context text;

begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_target_type not in ('profile', 'letter', 'dispatch', 'photo_moment', 'question_answer', 'reply') then
    raise exception 'Unknown report target.';
  end if;

  if p_reason not in (
    'scam_fraud', 'harassment', 'inappropriate_content',
    'impersonation', 'spam', 'other'
  ) then
    raise exception 'Unknown report reason.';
  end if;

  v_context := nullif(trim(both from coalesce(p_context, '')), '');
  if v_context is not null and char_length(v_context) > 500 then
    raise exception 'Explanation is too long.';
  end if;

  v_reported_user_id := null;
  v_evidence := null;


  if p_target_type = 'profile' then

    select
      p.id,
      jsonb_build_object(
        'pseudonym', p.pseudonym,
        'country', p.country,
        'gender', p.gender,
        'gender_custom', p.gender_custom,
        'age_range', p.age_range
      )
    into v_reported_user_id, v_evidence
    from public.profiles p
    where p.id = p_target_id;

    if v_reported_user_id is null then
      raise exception 'Member not found.';
    end if;


  elsif p_target_type = 'letter' then

    select
      l.sender_id,
      jsonb_build_object(
        'body', l.body,
        'sender_pseudonym', p.pseudonym,
        'letter_created_at', l.created_at
      )
    into v_reported_user_id, v_evidence
    from public.letters l
    join public.profiles p on p.id = l.sender_id
    where l.id = p_target_id
      and (l.sender_id = auth.uid() or l.recipient_id = auth.uid());

    if v_reported_user_id is null then
      raise exception 'Letter not found.';
    end if;


  elsif p_target_type = 'dispatch' then

    select
      d.author_id,
      jsonb_build_object(
        'title', d.title,
        'body', d.body,
        'author_pseudonym', p.pseudonym,
        'published_at', d.published_at
      )
    into v_reported_user_id, v_evidence
    from public.dispatches d
    join public.profiles p on p.id = d.author_id
    where d.id = p_target_id
      and d.status = 'published'
      and d.moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), d.author_id);

    if v_reported_user_id is null then
      raise exception 'Dispatch not found.';
    end if;


  elsif p_target_type = 'photo_moment' then

    select
      l.sender_id,
      jsonb_build_object(
        'image_path', m.image_path,
        'sender_pseudonym', p.pseudonym,
        'source', 'letter',
        'moment_created_at', m.created_at
      )
    into v_reported_user_id, v_evidence
    from public.moments m
    join public.letters l on l.id = m.letter_id
    join public.correspondences c on c.id = l.correspondence_id
    join public.profiles p on p.id = l.sender_id
    where m.id = p_target_id
      and m.type = 'photo'
      and (c.participant_low = auth.uid() or c.participant_high = auth.uid());

    if v_reported_user_id is null then
      select
        d.author_id,
        jsonb_build_object(
          'image_path', dm.image_path,
          'sender_pseudonym', p.pseudonym,
          'source', 'dispatch',
          'moment_created_at', dm.created_at
        )
      into v_reported_user_id, v_evidence
      from public.dispatch_moments dm
      join public.dispatches d on d.id = dm.dispatch_id
      join public.profiles p on p.id = d.author_id
      where dm.id = p_target_id
        and d.status = 'published'
        and d.moderation_status = 'visible'
        and not tempa_private.is_blocked_pair(auth.uid(), d.author_id);
    end if;

    if v_reported_user_id is null then
      raise exception 'Photo not found.';
    end if;


  elsif p_target_type = 'question_answer' then

    select
      qa.user_id,
      jsonb_build_object(
        'prompt', q.prompt,
        'body', qa.body,
        'author_pseudonym', p.pseudonym
      )
    into v_reported_user_id, v_evidence
    from public.question_answers qa
    join public.questions q on q.id = qa.question_id
    join public.profiles p on p.id = qa.user_id
    where qa.id = p_target_id
      and q.is_active = true
      and qa.moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), qa.user_id);

    if v_reported_user_id is null then
      raise exception 'Answer not found.';
    end if;


  elsif p_target_type = 'reply' then

    select
      r.author_id,
      jsonb_build_object(
        'body', r.body,
        'author_pseudonym', p.pseudonym,
        'dispatch_id', r.dispatch_id,
        'dispatch_title', d.title,
        'parent_reply_id', r.parent_reply_id,
        'reply_created_at', r.created_at
      )
    into v_reported_user_id, v_evidence
    from public.dispatch_replies r
    join public.dispatches d on d.id = r.dispatch_id
    join public.profiles p on p.id = r.author_id
    where r.id = p_target_id
      and d.status = 'published'
      and d.moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)
      and tempa_private.author_content_publicly_visible(d.author_id)
      and r.moderation_status = 'visible'
      and not tempa_private.is_blocked_pair(auth.uid(), r.author_id)
      and tempa_private.author_content_publicly_visible(r.author_id);

    if v_reported_user_id is null then
      raise exception 'Reply not found.';
    end if;

  end if;


  if v_reported_user_id = auth.uid() then
    raise exception 'You cannot report your own content.';
  end if;

  if exists (
    select 1 from public.reports
    where reporter_user_id = auth.uid()
      and target_type = p_target_type
      and target_id = p_target_id
  ) then
    raise exception 'You have already reported this.';
  end if;


  insert into public.reports (
    reporter_user_id, reported_user_id, target_type, target_id,
    reason, context, evidence_snapshot
  ) values (
    auth.uid(), v_reported_user_id, p_target_type, p_target_id,
    p_reason, v_context, v_evidence
  );

  -- Checkpoint 5 — durable post-event observation, never enforcement.
  -- See this migration's own header for the exception-guard/
  -- subtransaction reasoning.
  begin
    perform tempa_private.evaluate_behavior(
      p_subject_user_id := v_reported_user_id,
      p_report_check := true
    );
  exception when others then
    raise warning '[safety] evaluate_behavior (report_spike) failed for subject %: %', v_reported_user_id, sqlerrm;
  end;

end;
$function$;

revoke all on function public.report_content(text, uuid, text, text) from public;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;


-- ============================================================
-- 2. BLOCK_USER
-- ============================================================
-- Changed from its current live definition: after the block upsert (and
-- its Keep/Worth-Reading cascades) succeed, evaluate_behavior runs a
-- BLOCK_SPIKE check against the BLOCKED member (p_blocked_id — never
-- auth.uid(), the blocker).

create or replace function public.block_user(p_blocked_id uuid, p_scope text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_scope is null then
    raise exception 'Unknown block scope.';
  end if;

  if p_scope not in ('letters', 'full') then
    raise exception 'Unknown block scope.';
  end if;

  if auth.uid() = p_blocked_id then
    raise exception 'You cannot block yourself.';
  end if;

  if not exists (select 1 from public.profiles where id = p_blocked_id) then
    raise exception 'Member not found.';
  end if;

  if auth.uid() < p_blocked_id then
    perform 1 from public.profiles where id = auth.uid() for update;
    perform 1 from public.profiles where id = p_blocked_id for update;
  else
    perform 1 from public.profiles where id = p_blocked_id for update;
    perform 1 from public.profiles where id = auth.uid() for update;
  end if;

  insert into public.blocked_users (blocker_id, blocked_id, scope)
  values (auth.uid(), p_blocked_id, p_scope)
  on conflict (blocker_id, blocked_id) do update
    set scope = excluded.scope;

  if p_scope = 'full' then
    delete from public.kept_minds
    where (viewer_user_id = auth.uid() and kept_user_id = p_blocked_id)
       or (viewer_user_id = p_blocked_id and kept_user_id = auth.uid());

    delete from public.dispatch_worth_reading
    where (
      user_id = auth.uid()
      and dispatch_id in (select id from public.dispatches where author_id = p_blocked_id)
    ) or (
      user_id = p_blocked_id
      and dispatch_id in (select id from public.dispatches where author_id = auth.uid())
    );
  end if;

  -- Checkpoint 5 — durable post-event observation, never enforcement.
  -- See this migration's own header for the exception-guard/
  -- subtransaction reasoning. Runs for either scope ('letters' or
  -- 'full') — both are a genuine block from the blocked member's own
  -- point of view, and BLOCK_SPIKE cares about being blocked, not which
  -- scope each individual block used.
  begin
    perform tempa_private.evaluate_behavior(
      p_subject_user_id := p_blocked_id,
      p_block_check := true
    );
  exception when others then
    raise warning '[safety] evaluate_behavior (block_spike) failed for subject %: %', p_blocked_id, sqlerrm;
  end;
end;
$function$;

revoke all on function public.block_user(uuid, text) from public, anon, authenticated;
grant execute on function public.block_user(uuid, text) to authenticated;

commit;
