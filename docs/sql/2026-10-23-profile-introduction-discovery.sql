-- Tempa coordinated writing-discovery release.
-- Profile intros are a narrowly scoped, consented and moderated Question-answer
-- subtype. Existing first-contact safety and correspondence RPCs remain intact.
-- DRAFT MIGRATION: requires review and CI gates before production application.
begin;
alter table public.profiles add column if not exists first_letter_offer_seen_at timestamptz;
insert into public.questions (prompt, is_active, is_flagship, slug, family)
values ('What brings you to Tempa, and what do you enjoy writing about?', false, false,
        'tempa-profile-introduction', 'profile_introduction')
on conflict do nothing;

create table if not exists public.profile_introductions (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  answer_id uuid not null unique references public.question_answers(id) on delete cascade,
  is_published boolean not null default false,
  approved_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profile_introductions enable row level security;
revoke all on public.profile_introductions from public, anon, authenticated;
grant select on public.profile_introductions to authenticated;

create policy profile_intro_owner_read on public.profile_introductions
for select to authenticated using (auth.uid() = owner_id);
create policy profile_intro_approved_read on public.profile_introductions
for select to authenticated using (
  is_published and approved_at is not null
  and exists (select 1 from public.public_profiles pp where pp.id = owner_id)
  and not tempa_private.is_blocked_pair(auth.uid(),owner_id)
  and not tempa_private.hidden_from_discovery(auth.uid(),owner_id)
  and tempa_private.author_content_publicly_visible(owner_id)
);

-- Cleanup is safe under both account-closure and question-answer deletion:
-- audit staff IDs are nullable and do not block a closed staff account.

-- No general member insert/update: only carefully constrained SECURITY DEFINER
-- functions can publish or withdraw an introduction.
create or replace function public.submit_my_profile_introduction(p_body text)
returns text language plpgsql security definer set search_path to 'pg_catalog' as $fn$
declare v_id uuid; v_answer uuid;
begin
  if auth.uid() is null or public.current_account_status() is distinct from 'active' then
    raise exception 'Active member required' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_body,''))) < 30
     or char_length(p_body) > 600 then
    raise exception 'Please write between 30 and 600 characters.' using errcode='22023';
  end if;
  select id into v_id from public.questions where slug='tempa-profile-introduction';
  if v_id is null then raise exception 'Introduction is unavailable.'; end if;
  select answer_id into v_answer from public.profile_introductions
  where owner_id=auth.uid() for update;
  if v_answer is null then
    insert into public.question_answers(user_id,question_id,body,is_current,moderation_status)
    values(auth.uid(),v_id,btrim(p_body),false,'pending')
    returning id into v_answer;
    insert into public.profile_introductions(owner_id,answer_id,is_published,approved_at)
    values(auth.uid(),v_answer,true,null);
  else
    update public.question_answers set body=btrim(p_body),moderation_status='pending',updated_at=now()
    where id=v_answer and user_id=auth.uid();
    update public.profile_introductions set is_published=true,approved_at=null,
      submitted_at=now(),updated_at=now() where owner_id=auth.uid();
  end if;
  return 'pending';
end;
$fn$;

create or replace function public.hide_my_profile_introduction()
returns boolean language plpgsql security definer set search_path to 'pg_catalog' as $fn$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  update public.profile_introductions set is_published=false, approved_at=null, updated_at=now()
  where owner_id=auth.uid();
  return found;
end;
$fn$;

-- Any direct change to an approved introduction's underlying Question answer
-- revokes its approval. The existing QA ownership policies remain intact.
create or replace function tempa_private.invalidate_profile_intro_on_answer_change()
returns trigger language plpgsql security definer set search_path to 'pg_catalog' as $fn$
begin
  if exists(select 1 from public.questions where id=old.question_id and slug='tempa-profile-introduction') then
    if new.user_id is distinct from old.user_id or new.question_id is distinct from old.question_id then
      raise exception 'Introduction ownership and source cannot change' using errcode='42501';
    end if;
    if new.body is distinct from old.body then
      new.moderation_status := 'pending';
      update public.profile_introductions set approved_at=null, updated_at=now()
      where answer_id=old.id;
    end if;
  end if;
  return new;
end;
$fn$;
create trigger protect_profile_intro_answer
before update on public.question_answers for each row
execute function tempa_private.invalidate_profile_intro_on_answer_change();

create policy approved_profile_intro_answer_read on public.question_answers
for select to authenticated using (
  moderation_status='visible'
  and exists(
    select 1 from public.profile_introductions pi
    join public.questions q on q.id=question_answers.question_id
    where q.slug='tempa-profile-introduction'
      and pi.answer_id=question_answers.id
      and pi.owner_id=question_answers.user_id
      and pi.is_published and pi.approved_at is not null
      and tempa_private.author_content_publicly_visible(question_answers.user_id)
  )
  and public.member_question_author_visible(user_id)
  and not tempa_private.is_blocked_pair(auth.uid(),user_id)
  and not tempa_private.hidden_from_discovery(auth.uid(),user_id)
);

create table if not exists public.profile_intro_review_audit(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 staff_id uuid references public.profiles(id) on delete set null,
 decision text not null check(decision in('approve','reject')),
 decided_at timestamptz not null default now()
);
alter table public.profile_intro_review_audit enable row level security;
revoke all on public.profile_intro_review_audit from public,anon,authenticated;

create or replace function public.admin_review_profile_intro(p_owner uuid,p_approve boolean)
returns boolean language plpgsql security definer set search_path to 'pg_catalog' as $fn$
declare v_answer uuid;
begin
 if auth.uid() is null or public.is_staff('admin') is distinct from true then
   raise exception 'Not authorized' using errcode='42501';
 end if;
 select pi.answer_id into v_answer from public.profile_introductions pi
 join public.question_answers qa on qa.id=pi.answer_id
 where pi.owner_id=p_owner and pi.is_published and pi.approved_at is null
   and qa.moderation_status='pending'
 for update of pi,qa;
 if not found then raise exception 'No pending introduction' using errcode='P0002'; end if;
 update public.question_answers set moderation_status=case when p_approve then 'visible' else 'hidden' end,
     moderated_at=now() where id=v_answer;
 update public.profile_introductions
   set approved_at=case when p_approve then now() else null end,
       is_published=p_approve, updated_at=now() where owner_id=p_owner;
 insert into public.profile_intro_review_audit(owner_id,staff_id,decision)
 values(p_owner,auth.uid(),case when p_approve then 'approve' else 'reject' end);
 return true;
end;
$fn$;

create or replace function public.admin_pending_profile_intros(p_limit integer default 30)
returns table(owner_id uuid, pseudonym text, body text, submitted_at timestamptz)
language sql stable security definer set search_path to 'pg_catalog' as $fn$
 select pi.owner_id,p.pseudonym,qa.body,pi.submitted_at
 from public.profile_introductions pi
 join public.profiles p on p.id=pi.owner_id
 join public.question_answers qa on qa.id=pi.answer_id
 where public.is_staff('admin') and pi.is_published
   and pi.approved_at is null and qa.moderation_status='pending'
 order by pi.submitted_at asc limit least(greatest(coalesce(p_limit,30),1),100)
$fn$;

-- Preserve the pre-existing first-letter security pipeline. An approved
-- introduction is represented by a Question-answer ID and validated by the
-- same standard first-letter safety token and capacity/relationship rules.
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
        and (
          public.room_question_published(a.question_id)
          or exists (
            select 1 from public.profile_introductions pi
            join public.questions intro_q on intro_q.id = a.question_id
            where intro_q.slug = 'tempa-profile-introduction'
              and pi.answer_id = a.id
              and pi.owner_id = p_author
              and pi.is_published
              and pi.approved_at is not null
              and tempa_private.author_content_publicly_visible(p_author)
          )
        )
    )
$function$;

-- Include explicitly published introductory text as an eligible writer in
-- the people directory, while preserving its existing authorization gates.
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
      coalesce(latest.id, profile_intro.id) AS latest_letter_id,
      coalesce(latest.title, profile_intro.title) AS latest_letter_title,
      left(coalesce(latest.body, profile_intro.body), 750) AS latest_letter_body,
      case when latest.id is not null then 'letter' when profile_intro.id is not null then 'introduction' else null end as latest_writing_kind
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
      select pi.answer_id as id, 'Personal introduction'::text as title, qa.body
      from public.profile_introductions pi
      join public.question_answers qa on qa.id = pi.answer_id
      where pi.owner_id = p.id
        and pi.is_published
        and pi.approved_at is not null
        and qa.moderation_status = 'visible'
        and tempa_private.author_content_publicly_visible(p.id)
      limit 1
    ) profile_intro on true
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
      AND (NOT coalesce(p_has_letter,true) OR latest.id IS NOT NULL OR profile_intro.id IS NOT NULL)
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
        'latest_writing_kind', n.latest_writing_kind
      ) ORDER BY n.rn)
      FROM numbered n WHERE n.rn <= v_limit),
      '[]'::jsonb
    )
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
revoke all on function public.submit_my_profile_introduction(text) from public,anon;
revoke all on function public.hide_my_profile_introduction() from public,anon;
revoke all on function public.admin_review_profile_intro(uuid,boolean) from public,anon;
revoke all on function public.admin_pending_profile_intros(integer) from public,anon;
grant execute on function public.submit_my_profile_introduction(text) to authenticated;
grant execute on function public.hide_my_profile_introduction() to authenticated;
grant execute on function public.admin_review_profile_intro(uuid,boolean) to authenticated;
grant execute on function public.admin_pending_profile_intros(integer) to authenticated;
commit;
