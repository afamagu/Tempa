-- Tempa — Board usability / author control checkpoint.
-- PREPARED 2026-09-09. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- One incremental migration against the CURRENT LIVE Dispatch schema
-- (docs/sql/2026-09-07-dispatches-and-board.sql, already executed).
-- Does NOT recreate or drop `dispatches`, and does not touch the
-- already-verified RLS, the one-active-share partial unique index, the
-- private storage bucket's core policies, Keep privacy, or view-state
-- privacy — every change here is additive or a narrow `CREATE OR
-- REPLACE FUNCTION` of an existing function's body.
--
-- Covers: broadening share_dispatch to any authenticated member of a
-- published Dispatch (author-only ownership check removed; the
-- one-active-share invariant and author-only revoke are unchanged);
-- update_dispatch (author-scoped edit RPC, same id, no new share
-- token); delete_dispatch (author-scoped delete RPC, relying on
-- existing cascades); a narrow storage DELETE policy so an author can
-- clean up their own Dispatch's image objects; and one-pinned-Dispatch-
-- per-profile (a nullable FK column + two tiny RPCs).
--
-- Run this whole file as one transaction.

begin;

-- ============================================================
-- 1. SHARE_DISPATCH — broadened: any authenticated member may
--    request/reuse a share link for a published Dispatch
-- ============================================================
-- The ONLY behavioral change from the live version: the `and
-- d.author_id = auth.uid()` clause is removed from the existence
-- check. Everything else is unchanged — published-only, the
-- get-or-create-via-ON-CONFLICT race-safety against
-- dispatch_shares_one_active_per_dispatch, SECURITY DEFINER for the
-- same reason as before (authenticated holds no INSERT grant on
-- dispatch_shares). revoke_dispatch_share is NOT touched by this
-- migration at all — it remains author-only, per the product rule
-- ("only the AUTHOR may revoke external sharing").
create or replace function public.share_dispatch(p_dispatch_id uuid)
returns public.dispatch_shares
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  result public.dispatch_shares;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.dispatches d
    where d.id = p_dispatch_id
      and d.status = 'published'
  ) then
    raise exception 'Only a published Dispatch may be shared.';
  end if;

  insert into public.dispatch_shares (dispatch_id)
  values (p_dispatch_id)
  on conflict (dispatch_id) where revoked_at is null do nothing;

  select *
  into result
  from public.dispatch_shares
  where dispatch_id = p_dispatch_id
    and revoked_at is null;

  return result;
end;
$function$;

revoke all on function public.share_dispatch(uuid) from public;
grant execute on function public.share_dispatch(uuid) to authenticated;

-- ============================================================
-- 2. UPDATE_DISPATCH — author-scoped edit, same id, same
--    validation as publish_dispatch, never touches dispatch_shares
-- ============================================================
-- SECURITY DEFINER, matching share_dispatch/revoke_dispatch_share's
-- own precedent: authenticated holds no UPDATE grant on `dispatches`
-- at all (deliberately — see the original migration's "immutable once
-- published" posture), so this RPC is the only edit path, with its
-- own ownership check as the entire gate. Topics and Moments are
-- replaced (delete-then-reinsert) rather than diffed — simplest
-- correct approach, and reuses the exact same per-item validation
-- publish_dispatch already performs, so an edit can never produce a
-- Dispatch state publishing itself wouldn't have allowed. Does NOT
-- touch published_at, status, or author_id — an edited Dispatch keeps
-- its original publish date and identity. Does NOT reference
-- dispatch_shares anywhere, so an active external share token survives
-- an edit untouched, continuing to resolve to the edited content the
-- next time it's read (get_shared_dispatch reads live dispatches.title/
-- body at request time, not a snapshot).
--
-- Known, explicit gap: editing away a still-image Moment does not
-- delete that image's storage object — only delete_dispatch (below)
-- cleans up storage, and only for a fully deleted Dispatch. An edit
-- that removes a Moment leaves an orphaned object in the author's own
-- storage.dispatch-photos folder. Recorded here rather than silently
-- assumed solved; see the Build Guide's own note on this.
create or replace function public.update_dispatch(
  p_dispatch_id uuid,
  p_title text,
  p_body text,
  p_topics text[] default '{}',
  p_moments jsonb default '[]'::jsonb
)
returns public.dispatches
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  result public.dispatches;
  topic text;
  normalized_topics text[] := '{}';
  paragraph_count integer;
  m jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.dispatches d
    where d.id = p_dispatch_id
      and d.author_id = auth.uid()
      and d.status = 'published'
  ) then
    raise exception 'Only the author of a published Dispatch may edit it.';
  end if;

  if char_length(trim(p_title)) = 0 then
    raise exception 'A Dispatch needs a title.';
  end if;

  if char_length(p_title) > 70 then
    raise exception 'Title is too long.';
  end if;

  if array_length(p_topics, 1) is not null and array_length(p_topics, 1) > 3 then
    raise exception 'A Dispatch may carry at most 3 topics.';
  end if;

  foreach topic in array coalesce(p_topics, '{}') loop
    topic := trim(topic);
    if char_length(topic) = 0 then
      continue;
    end if;
    if char_length(topic) > 40 then
      raise exception 'A topic is too long.';
    end if;
    if not exists (
      select 1 from unnest(normalized_topics) t where lower(t) = lower(topic)
    ) then
      normalized_topics := array_append(normalized_topics, topic);
    end if;
  end loop;

  if array_length(normalized_topics, 1) is not null and array_length(normalized_topics, 1) > 3 then
    raise exception 'A Dispatch may carry at most 3 topics.';
  end if;

  if coalesce(jsonb_array_length(p_moments), 0) > 0 then
    paragraph_count := coalesce(
      array_length(regexp_split_to_array(trim(both from p_body), '\n\s*\n'), 1),
      1
    );

    for m in select * from jsonb_array_elements(p_moments)
    loop
      if m->>'type' is distinct from 'photo' then
        raise exception 'Only still-image Moments are supported in a Dispatch.';
      end if;

      if
        (m->>'position')::integer < 0
        or (m->>'position')::integer >= paragraph_count
      then
        raise exception 'Moment position is out of range for this Dispatch.';
      end if;

      if auth.uid()::text is distinct from (storage.foldername(m->>'image_path'))[1] then
        raise exception 'A Moment photo must belong to the author.';
      end if;
    end loop;
  end if;

  update public.dispatches
  set title = p_title,
      body = p_body
  where id = p_dispatch_id;

  delete from public.dispatch_topics where dispatch_id = p_dispatch_id;
  if array_length(normalized_topics, 1) is not null then
    insert into public.dispatch_topics (dispatch_id, topic)
    select p_dispatch_id, t from unnest(normalized_topics) as t;
  end if;

  delete from public.dispatch_moments where dispatch_id = p_dispatch_id;
  if coalesce(jsonb_array_length(p_moments), 0) > 0 then
    insert into public.dispatch_moments (dispatch_id, position, image_path)
    select
      p_dispatch_id,
      (elem->>'position')::integer,
      elem->>'image_path'
    from jsonb_array_elements(p_moments) as elem;
  end if;

  select * into result from public.dispatches where id = p_dispatch_id;
  return result;
end;
$function$;

revoke all on function public.update_dispatch(uuid, text, text, text[], jsonb) from public;
grant execute on function public.update_dispatch(uuid, text, text, text[], jsonb) to authenticated;

-- ============================================================
-- 3. DELETE_DISPATCH — author-scoped, relies on existing cascades
-- ============================================================
-- dispatch_topics, dispatch_moments, dispatch_views, and
-- dispatch_shares all already reference dispatches(id) on delete
-- cascade (see the live migration) — deleting the dispatches row is
-- sufficient for all four to clean up automatically. profiles.
-- pinned_dispatch_id (section 5 below) uses on delete set null, so a
-- deleted Dispatch that happened to be pinned un-pins itself rather
-- than leaving a dangling reference. SECURITY DEFINER for the same
-- reason as update_dispatch: authenticated has no DELETE grant on
-- dispatches, deliberately.
create or replace function public.delete_dispatch(p_dispatch_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.dispatches d
    where d.id = p_dispatch_id
      and d.author_id = auth.uid()
  ) then
    raise exception 'Only the author of a Dispatch may delete it.';
  end if;

  delete from public.dispatches where id = p_dispatch_id;
end;
$function$;

revoke all on function public.delete_dispatch(uuid) from public;
grant execute on function public.delete_dispatch(uuid) to authenticated;

-- ============================================================
-- 4. STORAGE — a narrow DELETE policy so an author can clean up
--    their own Dispatch's image objects
-- ============================================================
-- The live migration deliberately had no UPDATE/DELETE storage policy
-- at all ("an uploaded-but-never-published photo is a known, accepted
-- orphan"). Deleting a Dispatch is a different case: the app can now
-- reliably remove that author's own images as part of the delete flow,
-- so it's worth closing this gap — scoped EXACTLY like the existing
-- INSERT policy (own folder only), never broader. This does not touch
-- dispatch_photos_select/dispatch_photos_select_shared (read access is
-- unchanged) and does not affect the private letter-photos bucket in
-- any way.
create policy dispatch_photos_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'dispatch-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- 5. ONE PINNED DISPATCH PER PROFILE
-- ============================================================
-- A single nullable FK column on profiles, not a relationship table —
-- "at most one" is trivially true by construction (one column, one
-- row per member), and `on delete set null` means a deleted Dispatch
-- automatically un-pins itself with no extra cleanup logic anywhere.
-- Never overloads question_answers.is_current — this is a completely
-- separate column on a completely separate table.
alter table public.profiles
  add column pinned_dispatch_id uuid references public.dispatches(id) on delete set null;

-- public_profiles is re-declared to include pinned_dispatch_id. This
-- codebase's own history left ambiguity about whether the languages/
-- intent columns (docs/sql/2026-08-31-public-profile-fields.sql) are
-- live yet — app code already tolerates their absence gracefully
-- (app/minds/[userId]/page.tsx). Rather than guess and risk this
-- CREATE OR REPLACE VIEW failing outright on a database where they
-- don't exist, this builds the view's column list dynamically from
-- information_schema, so it succeeds either way and always includes
-- pinned_dispatch_id (guaranteed to exist by this point in the same
-- transaction).
do $$
declare
  has_languages boolean;
  has_intent boolean;
  view_sql text;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'languages'
  ) into has_languages;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'intent'
  ) into has_intent;

  view_sql := 'create or replace view public.public_profiles as '
    || 'select id, pseudonym, country, gender, gender_custom, age_range';

  if has_languages then
    view_sql := view_sql || ', languages';
  end if;
  if has_intent then
    view_sql := view_sql || ', intent';
  end if;

  view_sql := view_sql || ', pinned_dispatch_id from public.profiles';

  execute view_sql;
end;
$$;

-- pin_dispatch/unpin_dispatch: SECURITY DEFINER so neither depends on
-- knowing or touching profiles' own (untracked-in-this-repo) RLS/grant
-- state at all — each function's own ownership check is the entire
-- gate, exactly like every other narrow RPC in this file. Pinning a
-- different Dispatch is a single UPDATE, so it atomically replaces
-- whatever was pinned before — no separate "unpin the old one first"
-- step is needed.
create or replace function public.pin_dispatch(p_dispatch_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.dispatches d
    where d.id = p_dispatch_id
      and d.author_id = auth.uid()
      and d.status = 'published'
  ) then
    raise exception 'Only the author of a published Dispatch may pin it.';
  end if;

  update public.profiles set pinned_dispatch_id = p_dispatch_id where id = auth.uid();
end;
$function$;

revoke all on function public.pin_dispatch(uuid) from public;
grant execute on function public.pin_dispatch(uuid) to authenticated;

create or replace function public.unpin_dispatch()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  update public.profiles set pinned_dispatch_id = null where id = auth.uid();
end;
$function$;

revoke all on function public.unpin_dispatch() from public;
grant execute on function public.unpin_dispatch() to authenticated;

commit;
