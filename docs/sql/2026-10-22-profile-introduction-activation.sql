-- PROFILE INTRODUCTIONS — reviewed standalone Question-backed content.
-- Reuse existing safety evaluation, moderation, first-letter context and limits.
-- No open letter is generated or published by this change.
BEGIN;
ALTER TABLE public.question_answers ADD COLUMN IF NOT EXISTS profile_intro_visible boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS auto_match_started_at timestamptz;
INSERT INTO public.questions(prompt,slug,family,is_active,is_flagship)
SELECT 'A few words about me','tempa-profile-introduction','introduction',true,false
WHERE NOT EXISTS (SELECT 1 FROM public.questions WHERE slug='tempa-profile-introduction');
ALTER POLICY "Answers to active questions are readable by authenticated users" ON public.question_answers USING ((((EXISTS ( SELECT 1
   FROM questions q
  WHERE ((q.id = question_answers.question_id) AND (q.is_active = true)))) AND (moderation_status = 'visible'::text) AND (NOT tempa_private.is_blocked_pair(auth.uid(), user_id)) AND (NOT tempa_private.hidden_from_discovery(auth.uid(), user_id)))) AND (question_id not in (select q.id from public.questions q where q.slug='tempa-profile-introduction') or profile_intro_visible));
ALTER POLICY "room_published_answer_read" ON public.question_answers USING (((room_reading_allowed() AND room_question_published(question_id) AND (moderation_status = 'visible'::text) AND member_question_author_visible(user_id) AND (NOT tempa_private.is_blocked_pair(auth.uid(), user_id)) AND (NOT tempa_private.hidden_from_discovery(auth.uid(), user_id)))) AND (question_id not in (select q.id from public.questions q where q.slug='tempa-profile-introduction') or profile_intro_visible));
CREATE OR REPLACE FUNCTION public.set_my_profile_intro_visibility(p_visible boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $fn$
DECLARE v_updated integer;
BEGIN
 IF auth.uid() IS NULL OR p_visible IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_visible AND public.current_account_status() <> 'active' THEN RAISE EXCEPTION 'Not available' USING ERRCODE='42501'; END IF;
 UPDATE public.question_answers qa SET profile_intro_visible=p_visible,updated_at=now()
 FROM public.questions q WHERE qa.question_id=q.id AND q.slug='tempa-profile-introduction'
 AND qa.user_id=auth.uid() AND qa.moderation_status='visible';
 GET DIAGNOSTICS v_updated=ROW_COUNT;
 IF v_updated <> 1 THEN RAISE EXCEPTION 'Introduction unavailable' USING ERRCODE='42501'; END IF;
 RETURN p_visible;
END; $fn$;
REVOKE ALL ON FUNCTION public.set_my_profile_intro_visibility(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_my_profile_intro_visibility(boolean) TO authenticated;

-- Existing room_question_published with a narrow introduction visibility gate.
CREATE OR REPLACE FUNCTION public.room_question_published(p_question_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select public.room_reading_allowed()
    and exists (
      select 1
      from public.questions q
      where q.id = p_question_id
        and (
          q.is_flagship
          or (q.slug='tempa-profile-introduction' and q.is_active)
          or (q.is_active and q.current_position is not null)
          or exists (
            select 1
            from public.admin_audit_log a
            where a.target_type = 'question'
              and a.target_id = q.id
              and a.action in (
                'room_question_made_current',
                'room_question_archived',
                'room_question_started'
              )
          )
        )
    )
$function$
;

-- Existing room_answer_can_start_letter with a narrow introduction visibility gate.
CREATE OR REPLACE FUNCTION public.room_answer_can_start_letter(p_answer uuid, p_author uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select auth.uid() is not null
    and auth.uid() <> p_author
    and public.room_reading_allowed()
    and public.member_question_author_visible(p_author)
    and not tempa_private.is_correspondence_blocked_pair(auth.uid(), p_author)
    and not tempa_private.hidden_from_discovery(auth.uid(), p_author)
    and exists (
      select 1
      from public.question_answers a
      where a.id = p_answer
        and a.user_id = p_author
        and a.moderation_status = 'visible'
        and (a.question_id not in (select id from public.questions where slug='tempa-profile-introduction') or a.profile_intro_visible)
        and public.room_question_published(a.question_id)
    )
$function$
;

-- Existing can_evaluate_safety_context with a narrow introduction visibility gate.
CREATE OR REPLACE FUNCTION public.can_evaluate_safety_context(p_surface text, p_context_id uuid, p_question_answer_id uuid, p_secondary_context_id uuid, p_postcard jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_corr public.correspondences;
  v_recipient uuid;
  v_status text;
  v_first_letter_corr public.correspondences;
  v_reply_letter public.letters;
  v_dispatch_row record;
  v_question_active boolean;
  v_answer_moderation_status text;
  v_reply_dispatch record;
  v_parent_reply record;
  v_first_contact_attempt_count integer;
  v_previous_first_letter public.letters%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;

  if p_context_id is null then
    return false;
  end if;

  if p_surface in ('first_letter', 'first_letter_from_room_letter') then
    if p_context_id = auth.uid() then
      return false;
    end if;

    if public.current_account_status() in ('restricted', 'suspended', 'banned') then
      return false;
    end if;

    if tempa_private.is_correspondence_blocked_pair(auth.uid(), p_context_id) then
      return false;
    end if;

    if not exists (select 1 from public.profiles where id = p_context_id) then
      return false;
    end if;

    if p_surface = 'first_letter_from_room_letter' then
      if p_question_answer_id is not null or p_secondary_context_id is null then
        return false;
      end if;
      if not exists (
        select 1 from public.dispatches d
        where d.id = p_secondary_context_id
          and d.author_id = p_context_id
          and d.status = 'published'
          and d.moderation_status = 'visible'
          and coalesce(d.published_as,'member')='member'
          and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)
          and tempa_private.author_content_publicly_visible(d.author_id)
          and exists (
            select 1 from public.profiles member
            where member.id=d.author_id
              and member.is_editorial is distinct from true
          )
      ) then
        return false;
      end if;
    elsif p_question_answer_id is null or p_secondary_context_id is not null then
      return false;
    end if;

    select count(*)::integer
    into v_first_contact_attempt_count
    from public.letters l
    where l.sender_id = auth.uid()
      and l.recipient_id = p_context_id
      and l.reply_to_id is null
      and (
        l.question_answer_id is not null
        or exists (select 1 from public.dispatch_letter_contexts src where src.letter_id=l.id)
      );

    select l.*
    into v_previous_first_letter
    from public.letters l
    where l.sender_id = auth.uid()
      and l.recipient_id = p_context_id
      and l.reply_to_id is null
      and (
        l.question_answer_id is not null
        or exists (select 1 from public.dispatch_letter_contexts src where src.letter_id=l.id)
      )
    order by l.created_at desc
    limit 1;

    if v_first_contact_attempt_count = 0 then
      if p_surface = 'first_letter' and not exists (
        select 1
        from public.question_answers qa
        join public.questions q on q.id = qa.question_id
        where qa.id = p_question_answer_id
          and qa.user_id = p_context_id
          and (q.slug is distinct from 'tempa-profile-introduction' or (qa.profile_intro_visible and qa.moderation_status='visible'))
          and ((qa.is_current = true and q.is_active = true) or public.room_answer_can_start_letter(qa.id, qa.user_id))
      ) then
        return false;
      end if;
    elsif v_first_contact_attempt_count = 1 then
      if not (
        (
          v_previous_first_letter.status = 'sent'
          or (
            v_previous_first_letter.status = 'closed'
            and v_previous_first_letter.closed_by = 'system'
          )
        )
        and v_previous_first_letter.created_at <= now() - interval '7 days'
        and (
          (p_surface = 'first_letter'
           and p_question_answer_id = v_previous_first_letter.question_answer_id
           and exists (
             select 1 from public.question_answers qa
             where qa.id = p_question_answer_id and qa.user_id = p_context_id
           ))
          or
          (p_surface = 'first_letter_from_room_letter'
           and v_previous_first_letter.question_answer_id is null
           and exists (
             select 1 from public.dispatch_letter_contexts src
             where src.letter_id=v_previous_first_letter.id
               and src.dispatch_id=p_secondary_context_id
           ))
        )
      ) then
        return false;
      end if;
    else
      return false;
    end if;

    -- Correspondence-state check — see this section's own header
    -- comment. Read-only: no insert, no FOR UPDATE.
    select * into v_first_letter_corr
    from public.correspondences c
    where c.participant_low = least(auth.uid(), p_context_id)
      and c.participant_high = greatest(auth.uid(), p_context_id)
      and c.status in ('pending', 'active');

    if found then
      if v_first_letter_corr.status = 'active' or v_first_letter_corr.established_at is not null then
        return false;
      end if;

    end if;

    return true;

  elsif p_surface = 'reply' then
    select * into v_reply_letter
    from public.letters l
    where l.id = p_context_id
      and l.recipient_id = auth.uid()
      and l.deliver_at <= now()
      and (
        (l.reply_to_id is not null and l.status = 'sent')
        or
        (
          l.reply_to_id is null
          and (
            l.status = 'sent'
            or (l.status = 'closed' and l.closed_by = 'system')
          )
        )
      );

    if not found then
      return false;
    end if;

    if tempa_private.is_correspondence_blocked_pair(auth.uid(), v_reply_letter.sender_id) then
      return false;
    end if;

    v_status := public.current_account_status();

    if v_status in ('suspended', 'banned') then
      return false;
    end if;

    if p_postcard is not null then
      if v_status = 'restricted' then
        return false;
      end if;

      -- A first, establishing reply cannot carry a Postcard — mirrors
      -- reply_to_letter's own `if is_first_reply then raise 'A Postcard
      -- is not available until after your first reply...'`. Unlike
      -- write_anytime below, reply_to_letter's own Postcard block never
      -- checks moments_qualified_for_viewer — preserved here exactly as
      -- the real RPC currently permits it (independent audit correction).
      if v_reply_letter.reply_to_id is null then
        return false;
      end if;

      if not tempa_private.postcard_shape_is_valid(p_postcard) then
        return false;
      end if;
    end if;

    return true;

  elsif p_surface = 'write_anytime' then
    select * into v_corr from public.correspondences where id = p_context_id;

    if not found then
      return false;
    end if;

    if auth.uid() <> v_corr.participant_low and auth.uid() <> v_corr.participant_high then
      return false;
    end if;

    v_recipient := case when auth.uid() = v_corr.participant_low then v_corr.participant_high else v_corr.participant_low end;

    if tempa_private.is_correspondence_blocked_pair(auth.uid(), v_recipient) then
      return false;
    end if;

    v_status := public.current_account_status();

    if v_status in ('suspended', 'banned') then
      return false;
    end if;

    if p_postcard is not null then
      if v_status = 'restricted' then
        return false;
      end if;

      -- write_letter's own Postcard block additionally requires
      -- moments_qualified_for_viewer — reply_to_letter's own does NOT
      -- (see the reply branch above); preserved as a genuinely
      -- surface-specific rule, not folded into postcard_shape_is_valid
      -- (independent audit correction).
      if not public.moments_qualified_for_viewer(p_context_id) then
        return false;
      end if;

      if not tempa_private.postcard_shape_is_valid(p_postcard) then
        return false;
      end if;
    end if;

    return v_corr.status = 'active' and v_corr.established_at is not null;

  -- ============================================================
  -- Checkpoint 4 — public text surfaces. Every check below is copied
  -- from the actual live RPC bodies (docs/sql/2026-09-28-title-postcard-
  -- and-edit-window.sql's publish_dispatch/update_dispatch, docs/sql/
  -- 2026-09-29-your-mark-production.sql's publish_question_answer,
  -- docs/sql/2026-09-23-dispatch-replies.sql's create_reply), re-read
  -- directly before writing this, not from memory. Title/topic/body
  -- length ceilings are NOT re-checked here — those are pure, DB-free
  -- product-shape rules, mirrored once in lib/safety/route-contract.ts
  -- against the SAME exported constants lib/dispatches.ts/lib/
  -- replies.ts already use (TITLE_MAX_CHARS/TOPIC_MAX_CHARS/
  -- TOPIC_MAX_COUNT/REPLY_MAX_CHARS), the same split already established
  -- for first_letter's own 2,000-char cap — this function only ever
  -- checks what actually needs a database read.
  -- ============================================================

  elsif p_surface = 'dispatch_publish' then
    -- No pre-existing Dispatch id at evaluation time — the trusted
    -- publish-context identity is the acting member's own auth.uid(),
    -- derived server-side (see this migration's own header note on
    -- safety_evaluations.context_id and lib/safety/route-contract.ts) —
    -- never a client-invented placeholder UUID. The Route Handler is
    -- what actually sets p_context_id := the authenticated user's own
    -- id; this check merely confirms that binding was honored.
    if p_context_id <> auth.uid() then
      return false;
    end if;

    -- publish_dispatch's own top-level gate is a single blanket check —
    -- unlike write_letter/reply_to_letter, 'restricted' blocks
    -- publishing a Dispatch AT ALL here, not merely a Postcard/Moment
    -- attachment, so there is no separate restricted-Postcard branch
    -- the way reply/write_anytime above have one.
    if public.current_account_status() in ('restricted', 'suspended', 'banned') then
      return false;
    end if;

    if p_postcard is not null and not tempa_private.postcard_shape_is_valid(p_postcard) then
      return false;
    end if;

    return true;

  elsif p_surface = 'dispatch_update' then
    if public.current_account_status() in ('restricted', 'suspended', 'banned') then
      return false;
    end if;

    -- update_dispatch has no p_postcard parameter at all — never invent
    -- one here either.
    if p_postcard is not null then
      return false;
    end if;

    select id, published_at into v_dispatch_row
    from public.dispatches
    where id = p_context_id
      and author_id = auth.uid()
      and status = 'published';

    if not found then
      return false;
    end if;

    -- The 30-minute post-publish edit window — published_at is the only
    -- authoritative anchor, exactly like update_dispatch's own check.
    if now() > v_dispatch_row.published_at + interval '30 minutes' then
      return false;
    end if;

    -- The Reply lock — bare row EXISTENCE, deliberately unfiltered by
    -- moderation_status/deleted_at, matching update_dispatch's own
    -- check exactly (no dispatch_replies row can ever be hard-deleted).
    if exists (select 1 from public.dispatch_replies where dispatch_id = p_context_id) then
      return false;
    end if;

    return true;

  elsif p_surface = 'question_answer' then
    if public.current_account_status() in ('restricted', 'suspended', 'banned') then
      return false;
    end if;

    -- publish_question_answer's own is_active check is NULL-tolerant in
    -- a specific way (a nonexistent p_question_id never raises from that
    -- check alone — SELECT INTO leaves the variable NULL, and `is not
    -- null and not v_question_active` is then simply false) — mirrored
    -- exactly below, EXCEPT this function additionally confirms the
    -- Question actually exists at all: an evaluation must not be
    -- authorized for a target that would fail with a foreign-key
    -- violation the instant the real INSERT ran, which is exactly the
    -- "payload the mutation could never accept" case this checkpoint
    -- exists to close — never a "fix" to publish_question_answer's own
    -- accepted behavior, which is untouched.
    if not exists (select 1 from public.questions where id = p_context_id) then
      return false;
    end if;

    select is_active into v_question_active from public.questions where id = p_context_id;
    if v_question_active is not null and not v_question_active then
      return false;
    end if;

    -- The hidden-answer freeze — mirrors publish_question_answer's own
    -- `if existing_moderation_status = 'hidden' then raise`.
    select moderation_status into v_answer_moderation_status
    from public.question_answers
    where user_id = auth.uid() and question_id = p_context_id;

    if v_answer_moderation_status = 'hidden' then
      return false;
    end if;

    return true;

  elsif p_surface = 'dispatch_reply' then
    if public.current_account_status() in ('restricted', 'suspended', 'banned') then
      return false;
    end if;

    select id, author_id, status, moderation_status into v_reply_dispatch
    from public.dispatches
    where id = p_context_id;

    if not found then
      return false;
    end if;

    -- LOCKED RULE, no exception for the Dispatch's own author — mirrors
    -- create_reply's own unconditional gate exactly.
    if v_reply_dispatch.status <> 'published' or v_reply_dispatch.moderation_status <> 'visible' then
      return false;
    end if;

    -- Full-scope block, either direction — the SAME helper create_reply
    -- itself uses (tempa_private.is_blocked_pair, never
    -- is_correspondence_blocked_pair: a Letters-scope Stop letters block
    -- must have zero effect here).
    if tempa_private.is_blocked_pair(auth.uid(), v_reply_dispatch.author_id)
       or not tempa_private.author_content_publicly_visible(v_reply_dispatch.author_id) then
      return false;
    end if;

    if p_secondary_context_id is not null then
      select id, dispatch_id, author_id, moderation_status, deleted_at into v_parent_reply
      from public.dispatch_replies
      where id = p_secondary_context_id;

      if not found then
        return false;
      end if;

      if v_parent_reply.dispatch_id <> p_context_id then
        return false;
      end if;

      -- A moderator-hidden OR member-deleted parent is not a legitimate
      -- new-Reply target — mirrors create_reply's own check exactly.
      if v_parent_reply.moderation_status <> 'visible' or v_parent_reply.deleted_at is not null then
        return false;
      end if;

      if tempa_private.is_blocked_pair(auth.uid(), v_parent_reply.author_id)
         or not tempa_private.author_content_publicly_visible(v_parent_reply.author_id) then
        return false;
      end if;
    end if;

    return true;

  else
    return false;
  end if;
end;
$function$
;

-- Existing get_member_introductions with a narrow introduction visibility gate.
CREATE OR REPLACE FUNCTION public.get_member_introductions(p_limit integer DEFAULT 7)
 RETURNS TABLE(candidate_id uuid, pseudonym text, country text, gender text, gender_custom text, age_range text, mark_id uuid, languages text[], intent text[], shared_languages text[], shared_intents text[], answer_id uuid, prompt text, body text, priority_tier integer)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  insert into public.member_introduction_state (viewer_id)
  values (auth.uid())
  on conflict (viewer_id) do nothing;

  return query
  with viewer as materialized (
    select
      auth.uid() as id,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(vp.languages)) = 'array'
              then to_jsonb(vp.languages)
            else '[]'::jsonb
          end
        )
      ) as languages,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(vp.intent)) = 'array'
              then to_jsonb(vp.intent)
            else '[]'::jsonb
          end
        )
      ) as intent
    from (select 1) _one
    left join public.public_profiles vp on vp.id = auth.uid()
  ),
  flagship as (
    select q.id
    from public.questions q
    where q.is_flagship = true
    limit 1
  ),
  partners as materialized (
    select
      case
        when c.participant_low = v.id then c.participant_high
        else c.participant_low
      end as user_id
    from public.correspondences c
    cross join viewer v
    where c.status in ('pending', 'active', 'paused')
      and (
        c.participant_low = v.id
        or c.participant_high = v.id
      )
  ),
  contacted as materialized (
    select l.recipient_id as user_id
    from public.letters_for_participant l
    cross join viewer v
    where l.sender_id = v.id
      and l.reply_to_id is null
  ),
  history as materialized (
    select
      h.candidate_id as user_id,
      greatest(
        h.last_presented_at,
        h.consumed_at
      ) as last_presented_at
    from public.member_introduction_history h
    cross join viewer v
    where h.viewer_id = v.id
  ),
  newcomers as materialized (
    select n.id as user_id
    from tempa_private.member_introduction_newcomer_ids() n
  ),
  representative as materialized (
    select distinct on (qa.user_id)
      qa.id,
      qa.user_id,
      qa.question_id,
      qa.body
    from public.question_answers qa
    cross join viewer v
    where qa.moderation_status = 'visible'
      and qa.user_id <> v.id
      and (qa.question_id not in (select id from public.questions where slug='tempa-profile-introduction') or qa.profile_intro_visible)
    order by
      qa.user_id,
      (
        qa.question_id = (
          select f.id from flagship f
        )
      ) desc nulls last,
      qa.is_current desc nulls last,
      qa.updated_at desc nulls last,
      qa.id
  ),
  visible_profiles as materialized (
    select
      p.id,
      p.pseudonym,
      p.country,
      p.gender,
      p.gender_custom,
      p.age_range,
      p.mark_id,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(p.languages)) = 'array'
              then to_jsonb(p.languages)
            else '[]'::jsonb
          end
        )
      ) as languages,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(p.intent)) = 'array'
              then to_jsonb(p.intent)
            else '[]'::jsonb
          end
        )
      ) as intent
    from public.public_profiles p
    cross join viewer v
    where p.id <> v.id
  ),
  candidates as materialized (
    select
      p.*,
      r.id as answer_id,
      r.question_id,
      r.body,
      array(
        select unnest(p.languages)
        intersect
        select unnest(v.languages)
        order by 1
      ) as shared_languages,
      array(
        select unnest(p.intent)
        intersect
        select unnest(v.intent)
        order by 1
      ) as shared_intents,
      case
        when h.user_id is not null then 2
        when nc.user_id is not null then 0
        else 1
      end as tier,
      h.last_presented_at,
      random() as sort_key
    from representative r
    join visible_profiles p on p.id = r.user_id
    cross join viewer v
    left join history h on h.user_id = p.id
    left join newcomers nc on nc.user_id = p.id
    where not exists (
      select 1
      from partners x
      where x.user_id = p.id
    )
      and not exists (
        select 1
        from contacted c
        where c.user_id = p.id
      )
      and (
        h.user_id is null
        or h.last_presented_at <= now() - interval '7 days'
      )
  ),
  picked as (
    select c.*
    from candidates c
    order by
      c.tier,
      c.sort_key,
      c.id
    limit least(greatest(coalesce(p_limit, 7), 1), 7)
  )
  select
    pk.id::uuid,
    pk.pseudonym::text,
    pk.country::text,
    pk.gender::text,
    pk.gender_custom::text,
    pk.age_range::text,
    pk.mark_id::uuid,
    pk.languages::text[],
    pk.intent::text[],
    pk.shared_languages::text[],
    pk.shared_intents::text[],
    pk.answer_id::uuid,
    q.prompt::text,
    pk.body::text,
    pk.tier::integer
  from picked pk
  left join public.questions q on q.id = pk.question_id
  order by
    pk.tier,
    pk.sort_key,
    pk.id;
end;
$function$
;

-- Existing get_member_introductions_v2 with a narrow introduction visibility gate.
CREATE OR REPLACE FUNCTION public.get_member_introductions_v2(p_limit integer DEFAULT 7)
 RETURNS TABLE(candidate_id uuid, pseudonym text, country text, gender text, gender_custom text, age_range text, mark_id uuid, languages text[], intent text[], shared_languages text[], shared_intents text[], answer_id uuid, prompt text, body text, priority_tier integer, source_type text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  insert into public.member_introduction_state (viewer_id)
  values (auth.uid())
  on conflict (viewer_id) do nothing;

  return query
  with viewer as materialized (
    select
      auth.uid() as id,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(vp.languages)) = 'array'
              then to_jsonb(vp.languages)
            else '[]'::jsonb
          end
        )
      ) as languages,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(vp.intent)) = 'array'
              then to_jsonb(vp.intent)
            else '[]'::jsonb
          end
        )
      ) as intent
    from (select 1) _one
    left join public.public_profiles vp on vp.id = auth.uid()
  ),
  flagship as (
    select q.id
    from public.questions q
    where q.is_flagship = true
    limit 1
  ),
  partners as materialized (
    select
      case
        when c.participant_low = v.id then c.participant_high
        else c.participant_low
      end as user_id
    from public.correspondences c
    cross join viewer v
    where c.status in ('pending', 'active', 'paused')
      and (
        c.participant_low = v.id
        or c.participant_high = v.id
      )
  ),
  contacted as materialized (
    select l.recipient_id as user_id
    from public.letters_for_participant l
    cross join viewer v
    where l.sender_id = v.id
      and l.reply_to_id is null
  ),
  history as materialized (
    select
      h.candidate_id as user_id,
      greatest(
        h.last_presented_at,
        h.consumed_at
      ) as last_presented_at
    from public.member_introduction_history h
    cross join viewer v
    where h.viewer_id = v.id
  ),
  newcomers as materialized (
    select n.id as user_id
    from tempa_private.member_introduction_newcomer_ids() n
  ),
  representative as materialized (
    select distinct on (writing.user_id) writing.*
    from (
      select d.id, d.author_id as user_id, null::uuid as question_id,
        d.body, 'board_letter'::text as source_type, 0 as source_rank,
        coalesce(d.published_at,d.created_at) as written_at
      from public.dispatches d
      where d.status='published' and d.moderation_status='visible'
        and d.published_as='member' and d.author_id<>auth.uid()
      union all
      select qa.id,qa.user_id,qa.question_id,qa.body,
        'question_answer'::text,case when q.slug='tempa-profile-introduction' then 1 else 2 end,qa.updated_at
      from public.question_answers qa
      join public.questions q on q.id=qa.question_id
      where qa.moderation_status='visible' and qa.user_id<>auth.uid()
        and (q.slug is distinct from 'tempa-profile-introduction' or qa.profile_intro_visible)
    ) writing
    order by writing.user_id,writing.source_rank,writing.written_at desc nulls last,writing.id
  ),
  visible_profiles as materialized (
    select
      p.id,
      p.pseudonym,
      p.country,
      p.gender,
      p.gender_custom,
      p.age_range,
      p.mark_id,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(p.languages)) = 'array'
              then to_jsonb(p.languages)
            else '[]'::jsonb
          end
        )
      ) as languages,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(p.intent)) = 'array'
              then to_jsonb(p.intent)
            else '[]'::jsonb
          end
        )
      ) as intent
    from public.public_profiles p
    cross join viewer v
    where p.id <> v.id
  ),
  candidates as materialized (
    select
      p.*,
      r.id as answer_id,
      r.question_id,
      r.body,
      r.source_type,
      array(
        select unnest(p.languages)
        intersect
        select unnest(v.languages)
        order by 1
      ) as shared_languages,
      array(
        select unnest(p.intent)
        intersect
        select unnest(v.intent)
        order by 1
      ) as shared_intents,
      case
        when h.user_id is not null then 2
        when nc.user_id is not null then 0
        else 1
      end as tier,
      h.last_presented_at,
      random() as sort_key
    from representative r
    join visible_profiles p on p.id = r.user_id
    cross join viewer v
    left join history h on h.user_id = p.id
    left join newcomers nc on nc.user_id = p.id
    where not exists (
      select 1
      from partners x
      where x.user_id = p.id
    )
      and not exists (
        select 1
        from contacted c
        where c.user_id = p.id
      )
      and (
        h.user_id is null
        or h.last_presented_at <= now() - interval '7 days'
      )
  ),
  picked as (
    select c.*
    from candidates c
    order by
      c.tier,
      c.sort_key,
      c.id
    limit least(greatest(coalesce(p_limit, 7), 1), 7)
  )
  select
    pk.id::uuid,
    pk.pseudonym::text,
    pk.country::text,
    pk.gender::text,
    pk.gender_custom::text,
    pk.age_range::text,
    pk.mark_id::uuid,
    pk.languages::text[],
    pk.intent::text[],
    pk.shared_languages::text[],
    pk.shared_intents::text[],
    pk.answer_id::uuid,
    q.prompt::text,
    pk.body::text,
    pk.tier::integer,
    pk.source_type::text
  from picked pk
  left join public.questions q on q.id = pk.question_id
  order by
    pk.tier,
    pk.sort_key,
    pk.id;
end;
$function$
;

-- Existing get_first_arrival_auto_matches with a narrow introduction visibility gate.
CREATE OR REPLACE FUNCTION public.get_first_arrival_auto_matches(p_limit integer DEFAULT 6)
 RETURNS TABLE(candidate_id uuid, pseudonym text, country text, gender text, gender_custom text, age_range text, mark_id uuid, languages text[], intent text[], shared_languages text[], shared_intents text[], answer_id uuid, prompt text, body text, priority_tier integer, source_type text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  insert into public.member_introduction_state (viewer_id)
  values (auth.uid())
  on conflict (viewer_id) do nothing;

  return query
  with viewer as materialized (
    select
      auth.uid() as id,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(vp.languages)) = 'array'
              then to_jsonb(vp.languages)
            else '[]'::jsonb
          end
        )
      ) as languages,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(vp.intent)) = 'array'
              then to_jsonb(vp.intent)
            else '[]'::jsonb
          end
        )
      ) as intent
    from (select 1) _one
    left join public.public_profiles vp on vp.id = auth.uid()
  ),
  flagship as (
    select q.id
    from public.questions q
    where q.is_flagship = true
    limit 1
  ),
  partners as materialized (
    select
      case
        when c.participant_low = v.id then c.participant_high
        else c.participant_low
      end as user_id
    from public.correspondences c
    cross join viewer v
    where c.status in ('pending', 'active', 'paused')
      and (
        c.participant_low = v.id
        or c.participant_high = v.id
      )
  ),
  contacted as materialized (
    select l.recipient_id as user_id
    from public.letters_for_participant l
    cross join viewer v
    where l.sender_id = v.id
      and l.reply_to_id is null
  ),
  history as materialized (
    select
      h.candidate_id as user_id,
      greatest(
        h.last_presented_at,
        h.consumed_at
      ) as last_presented_at
    from public.member_introduction_history h
    cross join viewer v
    where h.viewer_id = v.id
  ),
  newcomers as materialized (
    select n.id as user_id
    from tempa_private.member_introduction_newcomer_ids() n
  ),
  representative as materialized (
    select distinct on (writing.user_id) writing.*
    from (
      select d.id, d.author_id as user_id, null::uuid as question_id,
        d.body, 'board_letter'::text as source_type, 0 as source_rank,
        coalesce(d.published_at,d.created_at) as written_at
      from public.dispatches d
      where d.status='published' and d.moderation_status='visible'
        and d.published_as='member' and d.author_id<>auth.uid()
      union all
      select qa.id,qa.user_id,qa.question_id,qa.body,
        'question_answer'::text,case when q.slug='tempa-profile-introduction' then 1 else 2 end,qa.updated_at
      from public.question_answers qa
      join public.questions q on q.id=qa.question_id
      where qa.moderation_status='visible' and qa.user_id<>auth.uid()
        and (q.slug is distinct from 'tempa-profile-introduction' or qa.profile_intro_visible)
    ) writing
    order by writing.user_id,writing.source_rank,writing.written_at desc nulls last,writing.id
  ),
  visible_profiles as materialized (
    select
      p.id,
      p.pseudonym,
      p.country,
      p.gender,
      p.gender_custom,
      p.age_range,
      p.mark_id,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(p.languages)) = 'array'
              then to_jsonb(p.languages)
            else '[]'::jsonb
          end
        )
      ) as languages,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(to_jsonb(p.intent)) = 'array'
              then to_jsonb(p.intent)
            else '[]'::jsonb
          end
        )
      ) as intent
    from public.public_profiles p
    cross join viewer v
    where p.id <> v.id
  ),
  candidates as materialized (
    select
      p.*,
      r.id as answer_id,
      r.question_id,
      r.body,
      r.source_type,
      array(
        select unnest(p.languages)
        intersect
        select unnest(v.languages)
        order by 1
      ) as shared_languages,
      array(
        select unnest(p.intent)
        intersect
        select unnest(v.intent)
        order by 1
      ) as shared_intents,
      case
        when h.user_id is not null then 2
        when nc.user_id is not null then 0
        else 1
      end as tier,
      h.last_presented_at,
      hashtext('first-arrival:' || v.id::text || ':' || p.id::text) as sort_key
    from representative r
    join visible_profiles p on p.id = r.user_id
    cross join viewer v
    left join history h on h.user_id = p.id
    left join newcomers nc on nc.user_id = p.id
    where not exists (
      select 1
      from partners x
      where x.user_id = p.id
    )
      and not exists (
        select 1
        from contacted c
        where c.user_id = p.id
      )
      and h.user_id is null
      and p.languages && v.languages
  ),
  picked as (
    select c.*
    from candidates c
    order by
      cardinality(c.shared_intents) desc,
      cardinality(c.shared_languages) desc,
      c.sort_key,
      c.id
    limit least(greatest(coalesce(p_limit, 6), 1), 6)
  )
  select
    pk.id::uuid,
    pk.pseudonym::text,
    pk.country::text,
    pk.gender::text,
    pk.gender_custom::text,
    pk.age_range::text,
    pk.mark_id::uuid,
    pk.languages::text[],
    pk.intent::text[],
    pk.shared_languages::text[],
    pk.shared_intents::text[],
    pk.answer_id::uuid,
    q.prompt::text,
    pk.body::text,
    pk.tier::integer,
    pk.source_type::text
  from picked pk
  left join public.questions q on q.id = pk.question_id
  order by
    cardinality(pk.shared_intents) desc,
    cardinality(pk.shared_languages) desc,
    pk.sort_key,
    pk.id;
end;
$function$
;

-- Existing discover_room_writers with a narrow introduction visibility gate.
CREATE OR REPLACE FUNCTION public.discover_room_writers(p_country text DEFAULT NULL::text, p_language text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_age_range text DEFAULT NULL::text, p_intent text DEFAULT NULL::text, p_interest text DEFAULT NULL::text, p_has_letter boolean DEFAULT true, p_seed text DEFAULT ''::text, p_after_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_viewer uuid := auth.uid();
  v_result jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 6);
BEGIN
  IF v_viewer IS NULL OR public.current_account_status() IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Active member required' USING errcode = '42501';
  END IF;
  IF length(coalesce(p_seed,'')) > 80 OR length(coalesce(p_search,'')) > 80 THEN
    RAISE EXCEPTION 'Invalid directory request' USING errcode = '22023';
  END IF;

  WITH eligible AS MATERIALIZED (
    SELECT
      p.id, p.pseudonym, p.country, p.mark_id, p.languages,
      hashtextextended(p.id::text || ':' || coalesce(p_seed,''), 0) AS shuffle,
      latest.id AS latest_letter_id,
      introduction.id AS introduction_answer_id,
      introduction.body AS introduction_body,
      latest.title AS latest_letter_title,
      left(latest.body, 750) AS latest_letter_body
    FROM public.public_profiles p
    JOIN public.profiles member ON member.id=p.id
      AND member.is_editorial IS DISTINCT FROM true
    LEFT JOIN LATERAL (
      SELECT d.id, d.title, d.body
      FROM public.dispatches d
      WHERE d.author_id = p.id
        AND d.status = 'published'
        AND d.moderation_status = 'visible'
        AND coalesce(d.published_as,'member') = 'member'
        AND tempa_private.author_content_publicly_visible(d.author_id)
      ORDER BY d.published_at DESC, d.id DESC
      LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT qa.id, left(qa.body,750) AS body
      FROM public.question_answers qa
      JOIN public.questions q ON q.id=qa.question_id AND q.slug='tempa-profile-introduction' AND q.is_active
      WHERE qa.user_id=p.id AND qa.profile_intro_visible AND qa.moderation_status='visible'
        AND tempa_private.author_content_publicly_visible(qa.user_id)
      ORDER BY qa.updated_at DESC LIMIT 1
    ) introduction ON true
    WHERE p.id <> v_viewer
      AND NOT tempa_private.account_is_banned(p.id)
      AND NOT tempa_private.is_blocked_pair(v_viewer,p.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.account_deactivations ad
        WHERE ad.user_id = p.id AND ad.reactivated_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.account_closures ac WHERE ac.user_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.account_enforcement_state ae
        WHERE ae.user_id = p.id AND ae.status <> 'active'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.correspondences c
        JOIN public.correspondence_hidden_for_user h
          ON h.correspondence_id = c.id
        WHERE h.user_id = v_viewer
          AND (c.participant_low = p.id OR c.participant_high = p.id)
      )
      AND (NOT coalesce(p_has_letter,true) OR latest.id IS NOT NULL OR introduction.id IS NOT NULL)
      AND (nullif(p_country,'') IS NULL OR p.country = p_country)
      AND (nullif(p_language,'') IS NULL OR p_language = any(p.languages))
      AND (
        nullif(btrim(p_search),'') IS NULL OR
        position(lower(btrim(p_search)) in lower(concat_ws(' ',p.pseudonym,p.country,array_to_string(p.languages,' ')))) > 0
      )
      AND (nullif(p_gender,'') IS NULL OR p.gender = p_gender OR
        (p.gender = 'Self-describe' AND p.gender_custom = p_gender))
      AND (nullif(p_age_range,'') IS NULL OR p.age_range = p_age_range)
      AND (nullif(p_intent,'') IS NULL OR p_intent = any(p.intent))
      AND (nullif(p_interest,'') IS NULL OR EXISTS (
        SELECT 1 FROM public.profile_interests pi
        WHERE pi.viewer_user_id = p.id AND pi.interest_key = p_interest
      ))
  ),
  remaining AS MATERIALIZED (
    SELECT e.*
    FROM eligible e
    WHERE p_after_user_id IS NULL OR (e.shuffle,e.id) > (
      hashtextextended(p_after_user_id::text || ':' || coalesce(p_seed,''),0),
      p_after_user_id
    )
  ),
  numbered AS (
    SELECT remaining.*, row_number() OVER (ORDER BY shuffle,id) AS rn
    FROM remaining
  )
  SELECT jsonb_build_object(
    'has_more', EXISTS (SELECT 1 FROM numbered WHERE rn > v_limit),
    'entries', coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'user_id', n.id,
        'pseudonym', n.pseudonym,
        'country', n.country,
        'mark_id', n.mark_id,
        'languages', n.languages,
        'latest_letter_id', n.latest_letter_id,
        'latest_letter_title', n.latest_letter_title,
        'latest_letter_body', n.latest_letter_body,
        'introduction_answer_id', n.introduction_answer_id,
        'introduction_body', n.introduction_body
      ) ORDER BY n.rn)
      FROM numbered n WHERE n.rn <= v_limit),
      '[]'::jsonb
    )
  ) INTO v_result;
  RETURN v_result;
END;
$function$
;

-- Existing send_first_letter_core with a narrow introduction visibility gate.
CREATE OR REPLACE FUNCTION tempa_private.send_first_letter_core(p_recipient_id uuid, p_question_answer_id uuid, p_room_letter_id uuid, p_body text, p_safety_evaluation_id uuid, p_warning_acknowledged boolean DEFAULT false)
 RETURNS letters_for_participant
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_new_id uuid;
  v_correspondence_id uuid;
  v_participant_low uuid;
  v_participant_high uuid;
  v_correspondence_status text;
  v_established_at timestamptz;
  v_deliver_at timestamptz;
  v_expires_at timestamptz;
  v_attempt_count integer;
  v_previous_first_letter public.letters%rowtype;
  v_previous_correspondence public.correspondences%rowtype;
  result public.letters_for_participant;
  v_room public.dispatches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if auth.uid() = p_recipient_id then
    raise exception 'You cannot write a first-contact letter to yourself.';
  end if;

  -- B6 correction — see this migration's own header comment. Placed
  -- early, alongside the other cheap param-only checks, before any row
  -- lookup.
  if char_length(p_body) > 2000 then
    raise exception 'This letter is too long.' using errcode = '22023';
  end if;

  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'Recipient does not exist.';
  end if;

  if tempa_private.is_correspondence_blocked_pair(auth.uid(), p_recipient_id) then
    raise exception 'Recipient does not exist.';
  end if;

  if not exists (
    select 1 from public.profiles where id = p_recipient_id
  ) then
    raise exception 'Recipient does not exist.';
  end if;

  -- These two independent source types can never be mixed or forged.
  -- The public Room source must be authored by the intended recipient.
  if p_room_letter_id is not null then
    if p_question_answer_id is not null then
      raise exception 'Choose one first-contact source.' using errcode='22023';
    end if;
    select d.* into v_room
      from public.dispatches d
     where d.id = p_room_letter_id
       and d.author_id = p_recipient_id
       and d.status = 'published'
       and d.moderation_status = 'visible'
       and coalesce(d.published_as, 'member') = 'member'
       and not tempa_private.is_blocked_pair(auth.uid(), d.author_id)
       and tempa_private.author_content_publicly_visible(d.author_id)
          and exists (
            select 1 from public.profiles member
            where member.id=d.author_id
              and member.is_editorial is distinct from true
          )
     for share;
    if not found then
      raise exception 'This letter is no longer available for first contact.' using errcode='P0002';
    end if;
  elsif p_question_answer_id is null then
    raise exception 'A first-contact source is required.' using errcode='22023';
  end if;

  v_participant_low := least(auth.uid(), p_recipient_id);
  v_participant_high := greatest(auth.uid(), p_recipient_id);

  perform tempa_private.lock_relationship_capacity_pair(
    v_participant_low,
    v_participant_high
  );

  select count(*)::integer
  into v_attempt_count
  from public.letters l
  where l.sender_id = auth.uid()
    and l.recipient_id = p_recipient_id
    and l.reply_to_id is null
    and (
      l.question_answer_id is not null
      or exists (select 1 from public.dispatch_letter_contexts src where src.letter_id=l.id)
    );

  select l.*
  into v_previous_first_letter
  from public.letters l
  where l.sender_id = auth.uid()
    and l.recipient_id = p_recipient_id
    and l.reply_to_id is null
    and (
      l.question_answer_id is not null
      or exists (select 1 from public.dispatch_letter_contexts src where src.letter_id=l.id)
    )
  order by l.created_at desc
  limit 1
  for update;

  if v_attempt_count = 0 then
    if p_room_letter_id is null and not exists (
      select 1
      from public.question_answers qa
      join public.questions q on q.id = qa.question_id
      where qa.id = p_question_answer_id
        and qa.user_id = p_recipient_id
          and (q.slug is distinct from 'tempa-profile-introduction' or (qa.profile_intro_visible and qa.moderation_status='visible'))
          and ((qa.is_current = true and q.is_active = true) or public.room_answer_can_start_letter(qa.id, qa.user_id))
    ) then
      raise exception
        'That Question answer is not currently a live Discovery entry for the intended recipient.';
    end if;

    insert into public.correspondences(participant_low, participant_high)
    values (v_participant_low, v_participant_high)
    on conflict (participant_low, participant_high)
      where status = any (array['pending'::text, 'active'::text, 'paused'::text])
    do nothing
    returning id into v_correspondence_id;

    if v_correspondence_id is null then
      select c.id, c.status, c.established_at
      into v_correspondence_id, v_correspondence_status, v_established_at
      from public.correspondences c
      where c.participant_low = v_participant_low
        and c.participant_high = v_participant_high
        and c.status in ('pending', 'active', 'paused')
      for update;
    else
      select c.status, c.established_at
      into v_correspondence_status, v_established_at
      from public.correspondences c
      where c.id = v_correspondence_id
      for update;
    end if;

    if v_correspondence_status = 'active' or v_established_at is not null then
      raise exception
        'This correspondence is already established. Use write_letter instead.';
    end if;
  elsif v_attempt_count = 1 then
    if v_previous_first_letter.status = 'closed'
       and v_previous_first_letter.closed_by = 'recipient' then
      raise exception 'The recipient passed on the first letter.'
        using errcode = 'P0001', detail = 'FIRST_CONTACT_RECIPIENT_PASSED';
    end if;

    if not (
      v_previous_first_letter.status = 'sent'
      or (
        v_previous_first_letter.status = 'closed'
        and v_previous_first_letter.closed_by = 'system'
      )
    ) then
      raise exception 'The first letter is no longer eligible for a follow-up.'
        using errcode = 'P0001', detail = 'FIRST_CONTACT_NOT_UNANSWERED';
    end if;

    if v_previous_first_letter.created_at > now() - interval '7 days' then
      raise exception 'A follow-up is not available yet.'
        using errcode = 'P0001', detail = 'FIRST_CONTACT_FOLLOW_UP_TOO_SOON';
    end if;

    if p_room_letter_id is not null then
      if v_previous_first_letter.question_answer_id is not null
         or not exists (
           select 1 from public.dispatch_letter_contexts src
           where src.letter_id = v_previous_first_letter.id
             and src.dispatch_id = p_room_letter_id
         ) then
        raise exception 'The follow-up source does not match the first letter.'
          using errcode='P0001', detail='FIRST_CONTACT_CONTEXT_MISMATCH';
      end if;
    elsif p_question_answer_id is distinct from v_previous_first_letter.question_answer_id
       or not exists (
         select 1 from public.question_answers qa
         where qa.id = p_question_answer_id and qa.user_id = p_recipient_id
       ) then
      raise exception 'The follow-up context does not match the first letter.'
        using errcode='P0001', detail='FIRST_CONTACT_CONTEXT_MISMATCH';
    end if;

    v_correspondence_id := v_previous_first_letter.correspondence_id;

    select c.*
    into v_previous_correspondence
    from public.correspondences c
    where c.id = v_correspondence_id
    for update;

    if not found
       or v_previous_correspondence.established_at is not null
       or v_previous_correspondence.status in ('active', 'paused')
       or v_previous_correspondence.ended_by is not null then
      raise exception 'This correspondence is no longer available for a follow-up.'
        using errcode = 'P0001', detail = 'FIRST_CONTACT_NOT_UNANSWERED';
    end if;

    if exists (
      select 1
      from public.correspondences c
      where c.id <> v_correspondence_id
        and c.participant_low = v_participant_low
        and c.participant_high = v_participant_high
        and c.status in ('pending', 'active', 'paused')
    ) then
      raise exception 'There is already another open correspondence episode with this member.'
        using errcode = 'P0001', detail = 'FIRST_CONTACT_OTHER_EPISODE_OPEN';
    end if;

    if v_previous_correspondence.status = 'closed' then
      update public.correspondences
      set status = 'pending',
          closed_at = null
      where id = v_correspondence_id;
    elsif v_previous_correspondence.status <> 'pending' then
      raise exception 'This correspondence is no longer available for a follow-up.'
        using errcode = 'P0001', detail = 'FIRST_CONTACT_NOT_UNANSWERED';
    end if;
  else
    raise exception 'The one follow-up has already been used.'
      using errcode = 'P0001', detail = 'FIRST_CONTACT_FOLLOW_UP_USED';
  end if;

  v_new_id := pg_catalog.gen_random_uuid();
  v_deliver_at := now();
  v_expires_at := v_deliver_at + interval '72 hours';

  -- Checkpoint 3 — the one trusted consumption path. first_letter has
  -- no Postcard (p_postcard is always null here). Placed after v_new_id
  -- is generated so the evaluation's own signal (if any) can be linked
  -- to this exact Letter, and before the actual insert so a denied/
  -- invalid/already-used evaluation blocks the Letter from ever being
  -- created.
  perform tempa_private.consume_safety_evaluation(
    p_safety_evaluation_id,
    auth.uid(),
    case when p_room_letter_id is null then 'first_letter' else 'first_letter_from_room_letter' end,
    p_recipient_id,
    p_question_answer_id,
    p_room_letter_id,
    null,
    null,
    null,
    p_body,
    p_warning_acknowledged,
    v_new_id
  );

  insert into public.letters(
    id, sender_id, recipient_id, question_answer_id, correspondence_id,
    body, deliver_at, expires_at
  ) values (
    v_new_id, auth.uid(), p_recipient_id, p_question_answer_id,
    v_correspondence_id, p_body, v_deliver_at, v_expires_at
  );

  if p_room_letter_id is not null then
    insert into public.dispatch_letter_contexts(letter_id,dispatch_id,title_snapshot)
    values(v_new_id,v_room.id,v_room.title);
  end if;

  select * into result
  from public.letters_for_participant
  where id = v_new_id;

  return result;
end;
$function$
;
COMMIT;
