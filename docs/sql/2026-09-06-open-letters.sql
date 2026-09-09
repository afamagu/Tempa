-- Tempa — Open Letters: first functional vertical slice.
-- PREPARED 2026-09-06. NOT EXECUTED — review, then run in the Supabase
-- SQL editor.
--
-- An Open Letter is one member's writing, deliberately offered to the
-- wider authenticated TEMPA community — never a status update, never a
-- feed built around engagement. This migration adds exactly the table
-- and row-level policies the first vertical slice needs: create,
-- publish, browse, and read. No RPC is introduced — a plain insert
-- under RLS is sufficient (there is no multi-step transaction hazard
-- here the way publish_question_answer's demote-then-promote had), and
-- no update/delete policy exists at all yet, so once published a row
-- is immutable and undeletable at the database level — unpublishing
-- and editing are deliberately deferred rather than half-built (see
-- the Build Guide's Open Letters section for the full reasoning).
--
-- No title column: an Open Letter may begin naturally with its own
-- writing, exactly like a letter or a Question answer — nothing here
-- forces a member to invent a blog-post title. Browse/profile surfaces
-- derive their heading from the body's own first paragraph (see
-- lib/letters.ts's existing letterPreviewText, reused as-is).
--
-- body stays plain text using the SAME Bold/Italic rich-body-marker
-- encoding as letters.body and question_answers.body (see lib/letter-
-- editor-doc.ts) — no second formatting language, no schema change to
-- support it.

create table public.open_letters (
  id uuid primary key default gen_random_uuid(),

  author_id uuid not null
    references auth.users(id)
    on delete cascade,

  body text not null,

  -- 'unpublished' is reserved for a later checkpoint (see Build Guide)
  -- — nothing in this migration or the app ever writes it yet. Every
  -- row this version of the app creates is 'published' at insert time;
  -- there is no draft row on the server at all (drafting stays local,
  -- the same localStorage pattern every other letter composer already
  -- uses — see lib/letter-editor-draft.ts).
  status text not null default 'published',

  created_at timestamptz not null default now(),
  published_at timestamptz not null default now(),

  constraint open_letters_status_check
    check (status in ('published', 'unpublished')),

  constraint open_letters_body_not_blank
    check (
      char_length(regexp_replace(body, '\s+', '', 'g')) > 0
    ),

  -- A defensive/database ceiling only, matching the same reasoning as
  -- the established-correspondence length-policy checkpoint: Open
  -- Letters are long-form writing with no ordinary product-facing cap.
  constraint open_letters_body_max_length
    check (char_length(body) <= 200000)
);

-- Chronological browse (published_at desc) is the only ordering this
-- first pass needs — no ranking/popularity signal exists to index for.
create index open_letters_published_feed_idx
  on public.open_letters (published_at desc)
  where status = 'published';

-- An author's own profile-integration list (their published Open
-- Letters, newest first).
create index open_letters_author_published_idx
  on public.open_letters (author_id, published_at desc)
  where status = 'published';

alter table public.open_letters enable row level security;

-- Any authenticated member may read a published Open Letter — this is
-- the intentional public-within-the-community scope the product brief
-- describes. An author may always see their own rows regardless of
-- status (irrelevant today since every row is 'published', but keeps
-- this policy correct once 'unpublished' is ever actually used).
--
-- No existing blocking/report relationship table exists yet in this
-- schema (confirmed by inspection — Build Guide §24-E lists Block/
-- Report as not yet built), so there is nothing for this policy to
-- consult; once blocking exists, this is the policy to extend.
create policy open_letters_select_published
  on public.open_letters
  for select
  to authenticated
  using (status = 'published' or author_id = auth.uid());

-- A member may only ever insert their own authored row — auth.uid()
-- is read server-side by Postgres, never trusted from any client value.
create policy open_letters_insert_own
  on public.open_letters
  for insert
  to authenticated
  with check (author_id = auth.uid());

-- Deliberately no UPDATE or DELETE policy at all in this first pass —
-- see the doc comment above. Nothing above resembles a moderation
-- system; if abuse handling is needed before Block/Report exists, that
-- is a separate, explicit checkpoint.

revoke all on public.open_letters from public;
grant select, insert on public.open_letters to authenticated;
