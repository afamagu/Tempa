-- Tempa — per-correspondence feature acknowledgements.
-- PREPARED 2026-09-01. NOT EXECUTED. Review only — do not run until
-- explicitly approved, per the same workflow as every other migration
-- in this directory.
--
-- Replaces the localStorage-based "Moments are available here" notice
-- dismissal with real user-account state: a member should see that
-- notice once for a given correspondence EPISODE, regardless of which
-- device or browser they're on. This is deliberately separate from
-- guide_completions (2026-08-31-moments.sql): guide_completions tracks
-- the full Moments walkthrough, once, per user, GLOBALLY, forever — it
-- must not be touched by this table. This table tracks a much smaller,
-- per-correspondence fact and has nothing to say about the walkthrough.

create table public.correspondence_feature_acknowledgements (
  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  -- Scoped to one correspondence EPISODE, not the permanent participant
  -- pair — mirrors correspondence_id everywhere else in the schema
  -- (letters.correspondence_id, photo consent on correspondences
  -- itself). A closed episode and any later new episode between the
  -- same two people are different correspondence_id values and
  -- therefore get their own, independent acknowledgement rows.
  correspondence_id uuid not null
    references public.correspondences(id)
    on delete cascade,

  -- e.g. 'moments_available'. Free-text rather than an enum, matching
  -- guide_completions.guide_key, so a future per-correspondence feature
  -- notice doesn't need a migration to add.
  feature_key text not null,

  acknowledged_at timestamptz not null default now(),

  -- Composite primary key: also the uniqueness constraint the product
  -- rule asks for. Each participant acknowledges independently — one
  -- person's row never satisfies the other's — since user_id is part of
  -- the key, not derived from the correspondence.
  primary key (user_id, correspondence_id, feature_key)
);

alter table public.correspondence_feature_acknowledgements
enable row level security;

-- A member may read or create an acknowledgement only when BOTH hold:
-- it's their own row (auth.uid() = user_id) AND they're actually a
-- participant in the referenced correspondence. Ownership of the row
-- alone is not enough — without the participant check, a member could
-- insert a row against a correspondence_id they have no part in.
-- is_correspondence_participant() is the same SECURITY DEFINER helper
-- 2026-08-31-moments.sql already defines and grants to authenticated for
-- exactly this check, reused here rather than duplicated.
--
-- Only SELECT and INSERT are needed for this feature (read "have I
-- acknowledged this?", write "acknowledge it," never edit or remove an
-- acknowledgement) — no UPDATE or DELETE policy is defined, so both
-- remain fully denied under RLS regardless of any future grant.
create policy correspondence_feature_acknowledgements_select
  on public.correspondence_feature_acknowledgements
  for select
  using (
    auth.uid() = user_id
    and public.is_correspondence_participant(correspondence_id)
  );

create policy correspondence_feature_acknowledgements_insert
  on public.correspondence_feature_acknowledgements
  for insert
  with check (
    auth.uid() = user_id
    and public.is_correspondence_participant(correspondence_id)
  );

revoke all
on public.correspondence_feature_acknowledgements
from public, anon;

grant select, insert
on public.correspondence_feature_acknowledgements
to authenticated;
