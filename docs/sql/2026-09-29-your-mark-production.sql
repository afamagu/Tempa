-- Tempa — Your Mark production foundation.
-- PREPARED ONLY. Do not treat this file's presence as evidence that it
-- has been applied. The source photograph never reaches this schema or
-- Storage: only the browser-generated V2 PNG is uploaded.

-- ============================================================
-- 1. CORE RELATIONAL STATE / RPCS
-- ============================================================

begin;

-- Existing profiles are grandfathered. A trigger below forces every
-- profile inserted after this migration to start at `mark`.
alter table public.profiles
  add column onboarding_stage text not null default 'complete';

alter table public.profiles
  add constraint profiles_onboarding_stage_valid
  check (onboarding_stage in ('mark', 'question', 'complete'));

comment on column public.profiles.onboarding_stage is
  'Private durable onboarding state. Existing profiles are grandfathered as complete; new profiles start at mark; validated RPCs advance mark to question to complete.';

create table public.profile_marks (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  discarded_at timestamptz,
  constraint profile_marks_status_valid
    check (status in ('pending', 'active', 'retired', 'discarded')),
  constraint profile_marks_state_timestamps_valid check (
    (status = 'pending' and finalized_at is null and discarded_at is null)
    or (status = 'active' and finalized_at is not null and discarded_at is null)
    or (status = 'retired' and finalized_at is not null and discarded_at is null)
    or (status = 'discarded' and discarded_at is not null)
  )
);

comment on table public.profile_marks is
  'Private ownership registry for opaque public Mark identifiers. The source photograph is never stored.';
comment on column public.profile_marks.id is
  'Independently random public Mark identifier; the Storage object is exactly {id}.png and never contains owner_id.';
comment on column public.profile_marks.owner_id is
  'Private owner UUID; never exposed through public_profiles.';

create unique index profile_marks_one_pending_per_owner
  on public.profile_marks(owner_id) where status = 'pending';
create unique index profile_marks_one_active_per_owner
  on public.profile_marks(owner_id) where status = 'active';
create index profile_marks_owner_created_idx
  on public.profile_marks(owner_id, created_at desc);

alter table public.profiles add column mark_id uuid;
alter table public.profiles
  add constraint profiles_mark_id_fkey
  foreign key (mark_id) references public.profile_marks(id) on delete set null;
create index profiles_mark_id_idx
  on public.profiles(mark_id) where mark_id is not null;

comment on column public.profiles.mark_id is
  'Nullable opaque public Mark identity. The public object is {mark_id}.png; no profile/auth UUID appears in its path.';

alter table public.profile_marks enable row level security;
revoke all on table public.profile_marks from public, anon, authenticated;

-- Live preflight plus repository audit confirmed that no production
-- path directly updates profiles: profile creation is INSERT; pinning
-- is via pin_dispatch/unpin_dispatch RPCs; interests use their own
-- subsystem. The direct authenticated UPDATE allowlist is therefore
-- intentionally empty. Existing owner-row RLS remains enabled and is
-- not replaced or weakened here.
revoke update on table public.profiles from anon, authenticated;

-- No caller-role heuristic: every INSERT, regardless of supplied
-- values, starts in the new cohort and cannot assign a Mark.
create or replace function tempa_private.force_initial_profile_mark_state()
returns trigger
language plpgsql
security invoker
set search_path to 'pg_catalog'
as $function$
begin
  new.onboarding_stage := 'mark';
  new.mark_id := null;
  return new;
end;
$function$;

revoke all on function tempa_private.force_initial_profile_mark_state()
  from public, anon, authenticated;

create trigger profiles_force_initial_mark_stage
before insert on public.profiles
for each row execute function tempa_private.force_initial_profile_mark_state();

-- RPC writes get an independent ownership backstop: a non-null pointer
-- must identify this profile's active Mark.
create or replace function tempa_private.validate_profile_mark_ownership()
returns trigger
language plpgsql
security invoker
set search_path to 'pg_catalog'
as $function$
begin
  if new.mark_id is not null and not exists (
    select 1 from public.profile_marks pm
    where pm.id = new.mark_id
      and pm.owner_id = new.id
      and pm.status = 'active'
  ) then
    raise exception 'The selected Mark is not an active Mark owned by this profile.'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function tempa_private.validate_profile_mark_ownership()
  from public, anon, authenticated;

create trigger profiles_validate_mark_ownership
before update of mark_id on public.profiles
for each row execute function tempa_private.validate_profile_mark_ownership();

-- Storage predicates accept one flat opaque UUID.png key. There is no
-- user-id folder or other path component.
create or replace function public.profile_mark_upload_allowed(p_object_name text)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $function$
declare
  v_mark_id uuid;
begin
  if auth.uid() is null then return false; end if;
  if p_object_name is null
     or p_object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$'
  then
    return false;
  end if;
  v_mark_id := left(p_object_name, length(p_object_name) - 4)::uuid;
  return exists (
    select 1 from public.profile_marks pm
    where pm.id = v_mark_id
      and pm.owner_id = auth.uid()
      and pm.status = 'pending'
  );
end;
$function$;

revoke all on function public.profile_mark_upload_allowed(text) from public, anon;
grant execute on function public.profile_mark_upload_allowed(text) to authenticated;

create or replace function public.profile_mark_delete_allowed(p_object_name text)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $function$
declare
  v_mark_id uuid;
begin
  if auth.uid() is null then return false; end if;
  if p_object_name is null
     or p_object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$'
  then
    return false;
  end if;
  v_mark_id := left(p_object_name, length(p_object_name) - 4)::uuid;
  return exists (
    select 1 from public.profile_marks pm
    where pm.id = v_mark_id
      and pm.owner_id = auth.uid()
      and pm.status in ('retired', 'discarded')
  );
end;
$function$;

revoke all on function public.profile_mark_delete_allowed(text) from public, anon;
grant execute on function public.profile_mark_delete_allowed(text) to authenticated;

-- The partial unique index plus the locked profile row guarantees one
-- deterministic pending candidate. Repeated calls return that candidate
-- and report whether its generated PNG is already present.
create or replace function public.reserve_profile_mark()
returns table(mark_id uuid, object_name text, uploaded boolean)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_profile public.profiles%rowtype;
  v_mark public.profile_marks%rowtype;
  v_object_name text;
  v_uploaded boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles
  where id = auth.uid() for update;
  if not found then
    raise exception 'Create your profile before creating a Mark.';
  end if;
  if v_profile.onboarding_stage not in ('mark', 'complete') then
    raise exception 'A new Mark cannot be reserved at this onboarding step.';
  end if;

  select * into v_mark from public.profile_marks pm
  where pm.owner_id = auth.uid() and pm.status = 'pending'
  for update;

  if not found then
    insert into public.profile_marks(owner_id, status)
    values (auth.uid(), 'pending') returning * into v_mark;
  end if;

  v_object_name := v_mark.id::text || '.png';
  select exists (
    select 1 from storage.objects so
    where so.bucket_id = 'profile-marks' and so.name = v_object_name
  ) into v_uploaded;

  return query select v_mark.id, v_object_name, v_uploaded;
end;
$function$;

revoke all on function public.reserve_profile_mark() from public, anon;
grant execute on function public.reserve_profile_mark() to authenticated;

create or replace function public.discard_profile_mark(p_mark_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_profile public.profiles%rowtype;
  v_mark public.profile_marks%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles
  where id = auth.uid() for update;
  if not found then raise exception 'Profile not found.'; end if;

  select * into v_mark from public.profile_marks pm
  where pm.id = p_mark_id and pm.owner_id = auth.uid()
  for update;
  if not found then raise exception 'Mark reservation not found.'; end if;
  if v_mark.status = 'discarded' then return; end if;
  if v_mark.status <> 'pending' then
    raise exception 'Only a pending Mark may be discarded.';
  end if;

  update public.profile_marks
  set status = 'discarded', discarded_at = now()
  where id = v_mark.id;
end;
$function$;

revoke all on function public.discard_profile_mark(uuid) from public, anon;
grant execute on function public.discard_profile_mark(uuid) to authenticated;

create or replace function public.finalize_profile_mark(p_mark_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_profile public.profiles%rowtype;
  v_mark public.profile_marks%rowtype;
  v_object_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles
  where id = auth.uid() for update;
  if not found then
    raise exception 'Create your profile before finalizing a Mark.';
  end if;

  select * into v_mark from public.profile_marks pm
  where pm.id = p_mark_id and pm.owner_id = auth.uid()
  for update;
  if not found then raise exception 'Mark reservation not found.'; end if;

  -- Idempotent retry of the already-finalized association.
  if v_mark.status = 'active' and v_profile.mark_id = v_mark.id then
    return v_mark.id;
  end if;
  if v_mark.status <> 'pending' then
    raise exception 'This Mark is no longer an active reservation.';
  end if;
  if v_profile.onboarding_stage not in ('mark', 'complete') then
    raise exception 'A Mark cannot be finalized at this onboarding step.';
  end if;

  v_object_name := v_mark.id::text || '.png';
  if not exists (
    select 1 from storage.objects so
    where so.bucket_id = 'profile-marks' and so.name = v_object_name
  ) then
    raise exception 'The generated Mark has not finished uploading.';
  end if;

  update public.profile_marks set status = 'retired'
  where owner_id = auth.uid() and status = 'active' and id <> v_mark.id;
  update public.profile_marks
  set status = 'active',
      finalized_at = coalesce(finalized_at, now()),
      discarded_at = null
  where id = v_mark.id;

  update public.profiles
  set mark_id = v_mark.id,
      onboarding_stage = case
        when onboarding_stage = 'mark' then 'question'
        else onboarding_stage
      end
  where id = auth.uid();

  return v_mark.id;
end;
$function$;

revoke all on function public.finalize_profile_mark(uuid) from public, anon;
grant execute on function public.finalize_profile_mark(uuid) to authenticated;

-- Repairs question-stage state only when no Flagship exists or the
-- caller already has the required Flagship answer.
create or replace function public.complete_flagship_onboarding()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_stage text;
  v_flagship_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select p.onboarding_stage into v_stage
  from public.profiles p where p.id = auth.uid() for update;
  if not found then raise exception 'Profile not found.'; end if;
  if v_stage = 'complete' then return; end if;
  if v_stage <> 'question' then
    raise exception 'The Flagship onboarding step is not currently available.';
  end if;

  -- The documented-live questions_is_flagship_unique partial unique
  -- index is asserted below; this scalar SELECT can return at most one.
  select q.id into v_flagship_id
  from public.questions q where q.is_flagship = true;

  if v_flagship_id is null then
    update public.profiles set onboarding_stage = 'complete'
    where id = auth.uid();
    return;
  end if;

  if not exists (
    select 1 from public.question_answers qa
    where qa.user_id = auth.uid() and qa.question_id = v_flagship_id
  ) then
    raise exception 'Complete the required Flagship Question before continuing.';
  end if;

  update public.profiles set onboarding_stage = 'complete'
  where id = auth.uid();
end;
$function$;

revoke all on function public.complete_flagship_onboarding() from public, anon;
grant execute on function public.complete_flagship_onboarding() to authenticated;

-- Append only the opaque mark_id to the verified-live nine-column,
-- block-aware security-barrier view. Private ownership and onboarding
-- state are not exposed.
create or replace view public.public_profiles
with (security_barrier = true)
as
select
  p.id,
  p.pseudonym,
  p.country,
  p.gender,
  p.gender_custom,
  p.age_range,
  p.languages,
  p.intent,
  p.pinned_dispatch_id,
  p.mark_id
from public.profiles p
where auth.uid() = p.id
   or not tempa_private.is_blocked_pair(auth.uid(), p.id);

revoke all on public.public_profiles from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.public_profiles from authenticated;
grant select on public.public_profiles to authenticated;

-- Audited live function reproduced exactly except for the final,
-- transaction-atomic question -> complete update when the successfully
-- published Question is the unique current Flagship.
create or replace function public.publish_question_answer(p_question_id uuid, p_body text)
returns public.question_answers
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  result public.question_answers;
  question_is_active boolean;
  existing_moderation_status text;
  has_current boolean;
  should_promote boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if public.current_account_status() in ('restricted', 'suspended', 'banned') then
    raise exception 'This action is not available right now.';
  end if;

  select is_active into question_is_active
  from public.questions where id = p_question_id;
  if question_is_active is not null and not question_is_active then
    raise exception 'This Question is no longer accepting answers.';
  end if;

  select moderation_status into existing_moderation_status
  from public.question_answers
  where user_id = auth.uid() and question_id = p_question_id;
  if existing_moderation_status = 'hidden' then
    raise exception 'This answer has been hidden and cannot be edited.';
  end if;

  select exists (
    select 1 from public.question_answers
    where user_id = auth.uid() and is_current = true
  ) into has_current;
  should_promote := not has_current;

  if should_promote then
    update public.question_answers set is_current = false
    where user_id = auth.uid() and question_id <> p_question_id;
  end if;

  insert into public.question_answers(user_id, question_id, body, is_current, updated_at)
  values (auth.uid(), p_question_id, p_body, should_promote, now())
  on conflict (user_id, question_id)
  do update set
    body = excluded.body,
    updated_at = now(),
    is_current = case
      when should_promote then true
      else public.question_answers.is_current
    end
  returning * into result;

  if exists (
    select 1 from public.questions q
    where q.id = p_question_id and q.is_flagship = true
  ) then
    update public.profiles set onboarding_stage = 'complete'
    where id = auth.uid() and onboarding_stage = 'question';
  end if;

  return result;
end;
$function$;

revoke all on function public.publish_question_answer(uuid, text) from public, anon;
grant execute on function public.publish_question_answer(uuid, text) to authenticated;

-- Fail closed if the documented-live Flagship prerequisite differs in
-- any material way. It is deliberately verified, never recreated.
do $verification$
declare
  v_unique boolean;
  v_valid boolean;
  v_ready boolean;
  v_live boolean;
  v_predicate text;
  v_definition text;
begin
  select i.indisunique, i.indisvalid, i.indisready, i.indislive,
         pg_get_expr(i.indpred, i.indrelid), pg_get_indexdef(i.indexrelid)
  into v_unique, v_valid, v_ready, v_live, v_predicate, v_definition
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'questions_is_flagship_unique';

  if not found
     or not coalesce(v_unique, false)
     or not coalesce(v_valid, false)
     or not coalesce(v_ready, false)
     or not coalesce(v_live, false)
     or v_definition not ilike '%public.questions%'
     or v_definition not ilike '%(is_flagship)%'
     or v_predicate is null
     or regexp_replace(lower(v_predicate), '[[:space:]()]', '', 'g') <> 'is_flagship=true'
  then
    raise exception 'VERIFY FAILED: live questions_is_flagship_unique prerequisite is absent or malformed.';
  end if;

  if has_table_privilege('authenticated', 'public.profiles', 'UPDATE') then
    raise exception 'VERIFY FAILED: authenticated retains table-level profiles UPDATE.';
  end if;
  if exists (
    select 1 from information_schema.column_privileges cp
    where cp.table_schema = 'public' and cp.table_name = 'profiles'
      and cp.grantee = 'authenticated' and cp.privilege_type = 'UPDATE'
  ) then
    raise exception 'VERIFY FAILED: authenticated retains a profiles column UPDATE grant.';
  end if;
  if has_table_privilege('authenticated', 'public.profile_marks', 'SELECT')
     or has_table_privilege('authenticated', 'public.profile_marks', 'INSERT')
     or has_table_privilege('authenticated', 'public.profile_marks', 'UPDATE')
     or has_table_privilege('authenticated', 'public.profile_marks', 'DELETE')
  then
    raise exception 'VERIFY FAILED: authenticated has direct profile_marks access.';
  end if;
  if not has_function_privilege('authenticated', 'public.reserve_profile_mark()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.finalize_profile_mark(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.complete_flagship_onboarding()', 'EXECUTE')
  then
    raise exception 'VERIFY FAILED: required authenticated Mark RPC grant is absent.';
  end if;
end;
$verification$;

commit;
-- Bucket creation is separate from storage.objects policy DDL because
-- this repository documents Supabase Storage lock contention when both
-- are combined in one transaction.
begin;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('profile-marks', 'profile-marks', true, 1048576, array['image/png'])
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;

begin;

drop policy if exists profile_marks_insert on storage.objects;
drop policy if exists profile_marks_delete on storage.objects;
drop policy if exists profile_marks_update on storage.objects;
drop policy if exists profile_marks_select on storage.objects;

create policy profile_marks_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-marks'
    and public.profile_mark_upload_allowed(name)
  );

-- No UPDATE policy: duplicate insert and upsert/overwrite both fail.
create policy profile_marks_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-marks'
    and public.profile_mark_delete_allowed(name)
  );

-- No SELECT policy: known opaque public URLs resolve through the public
-- bucket endpoint without granting storage.objects enumeration.

commit;
