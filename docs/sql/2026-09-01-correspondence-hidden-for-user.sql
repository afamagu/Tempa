-- Tempa — "Delete from my Letterbox": participant-scoped hide, not a
-- shared delete.
-- PREPARED 2026-09-01. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- Product meaning: "Delete from my Letterbox" hides a correspondence
-- episode from the acting member's OWN Letterbox list only. It never
-- hard-deletes the correspondence, never removes the other
-- participant's copy, and never destroys anything a future safety/
-- moderation review might need — the underlying letters/correspondence
-- rows are completely untouched by this table. Architecture mirrors
-- correspondence_feature_acknowledgements
-- (2026-09-01-correspondence-feature-acknowledgements.sql) exactly:
-- one row per (user, correspondence), RLS-scoped to the acting member,
-- with a participant check so a member can't record a hide against a
-- correspondence they have no part in.
--
-- Deliberately not a generic "Trash" folder for this checkpoint — there
-- is no undo/restore UI yet, just the hide-state row existing or not.
-- A future "recently deleted" surface could read this same table
-- without a schema change.

create table public.correspondence_hidden_for_user (
  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  correspondence_id uuid not null
    references public.correspondences(id)
    on delete cascade,

  hidden_at timestamptz not null default now(),

  primary key (user_id, correspondence_id)
);

alter table public.correspondence_hidden_for_user
enable row level security;

-- Same shape as correspondence_feature_acknowledgements: a member may
-- only read or write their own hide-state rows, and only for a
-- correspondence they actually participate in.
create policy correspondence_hidden_for_user_select
  on public.correspondence_hidden_for_user
  for select
  using (
    auth.uid() = user_id
    and public.is_correspondence_participant(correspondence_id)
  );

create policy correspondence_hidden_for_user_insert
  on public.correspondence_hidden_for_user
  for insert
  with check (
    auth.uid() = user_id
    and public.is_correspondence_participant(correspondence_id)
  );

-- A member may also un-hide (delete their own hide row) — there is no
-- "undo" UI in this checkpoint, but the policy exists so a future
-- "recently deleted" surface can restore without a new migration.
create policy correspondence_hidden_for_user_delete
  on public.correspondence_hidden_for_user
  for delete
  using (auth.uid() = user_id);

revoke all
on public.correspondence_hidden_for_user
from public, anon;

grant select, insert, delete
on public.correspondence_hidden_for_user
to authenticated;
