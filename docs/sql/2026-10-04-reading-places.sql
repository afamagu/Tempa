-- ============================================================
-- TEMPA — READING PLACES: automatic resume only
-- STATUS: NOT EXECUTED — review, then run in the Supabase SQL editor.
-- Entirely separate from the Safety 2 migrations.
-- ============================================================
--
-- Product decision, 2026-09-24: the explicit "Save my place" / ribbon
-- concept was removed. Tempa should simply remember where a member
-- stopped reading and return them there automatically. No deliberate
-- bookmark state is stored here.
--
-- Dispatches already have a shipped automatic-resume mechanism in
-- public.dispatch_views and continue using it unchanged. This table is
-- used by Letters (including the same Letter opened inside the reply
-- composer's source-letter panel), but keeps the generic content_type
-- shape so the resume mechanism can be reused without another table if
-- needed later.
--
-- PRIVACY: no Letter/Dispatch body text is stored — only ids and integer
-- reading anchors. RLS limits each row to its owning member.

begin;

create table public.reading_places (
  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  content_type text not null
    check (content_type in ('letter', 'dispatch')),

  content_id uuid not null,

  resume_paragraph_index integer
    check (resume_paragraph_index is null or resume_paragraph_index >= 0),
  resume_char_offset integer
    check (resume_char_offset is null or resume_char_offset >= 0),
  resume_updated_at timestamptz,
  constraint reading_places_resume_offset_needs_index
    check (resume_char_offset is null or resume_paragraph_index is not null),

  created_at timestamptz not null default now(),

  primary key (user_id, content_type, content_id)
);

alter table public.reading_places enable row level security;

create policy reading_places_own
  on public.reading_places
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.reading_places from public, anon, authenticated;
grant select, insert, update on public.reading_places to authenticated;

commit;
