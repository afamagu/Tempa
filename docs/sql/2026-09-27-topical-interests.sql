-- ============================================================
-- TEMPA — BOARD PERSONALIZATION PHASE 2B: TOPICAL INTERESTS
-- ============================================================
-- STATUS: PREPARED. NOT EXECUTED. Review only — do not run against the
-- live database until explicitly approved.
--
-- Adds a small, curated Interest taxonomy (public.interests), a
-- deterministic Dispatch-topic -> Interest alias table
-- (public.interest_topic_aliases), a per-viewer selection table
-- (public.profile_interests), and one new RPC to replace a viewer's own
-- selection atomically (set_profile_interests). The taxonomy and alias
-- rows below are a byte-for-byte mirror of lib/interests.ts's own
-- INTEREST_TAXONOMY/INTEREST_ALIASES constants — that TS file is the
-- documented source of truth; this migration's seed data must be kept
-- in sync with it by hand (lib/interests.test.ts proves the TS side's
-- own internal consistency; there is no live-DB test harness in this
-- codebase to cross-check the two automatically — a human keeping both
-- edits in the same commit is the actual discipline here).
--
-- board_feed_page (Phase 2A) is modified via a plain CREATE OR REPLACE —
-- NOT a DROP+CREATE — because this checkpoint deliberately makes NO
-- change to its argument list or RETURNS TABLE shape: topical relevance
-- is folded in purely as an internal tie-break inside the existing
-- rank_key computation, never as a new returned column, never as a new
-- parameter. Reading Trail V2's (seen_bucket, rank_key, seed_hash, id)
-- cursor contract is therefore completely unaffected by this migration.
--
-- ============================================================
-- RANKING PRINCIPLE — a tie-shaping signal, never a new outer bucket
-- ============================================================
-- Phase 2A's ranking is unchanged in every respect except one: within
-- each of the three per-seen_bucket streams (Keep, second familiarity
-- signal, Discovery), the existing `order by author_seq, seed_hash`
-- author-diversity tie-break becomes `order by author_seq,
-- topical_rank, seed_hash`, where topical_rank is 0 (matched) or 1
-- (unmatched). This ONLY reorders candidates that already tied on
-- author_seq (the same "Nth most recent, this author" position across
-- distinct authors) — it can never change which stream a Dispatch
-- belongs to, never change a stream's size, and therefore never changes
-- the Keep:second-signal=3:1 or Familiar:Discovery=1:1 divisor math at
-- all (that math depends only on each row's POSITION within its own
-- stream, never on which specific row occupies which position). seed_
-- hash remains the final, lowest-priority tie-break and is still the
-- ONLY thing deciding order between two candidates that agree on both
-- author_seq and topical_rank.
--
-- ZERO-INTEREST DEGRADE, proved structurally rather than by a special
-- case: when a viewer has selected no Interests, topical_matches (below)
-- is empty for them, so is_topical_match is false for every row, so
-- `case when is_topical_match then 0 else 1 end` evaluates to the SAME
-- constant (1) for every row in every author_seq group — a constant
-- sort key changes nothing, so the ORDER BY collapses back to exactly
-- `order by author_seq, seed_hash`, Phase 2A's own original expression,
-- byte-for-byte. No special-cased "if no interests, skip this" branch
-- was needed or written; the degrade is a mathematical consequence of
-- the tie-break's own definition.
--
-- ============================================================
-- TOPIC -> INTEREST MATCHING — exact token/phrase only, never substring
-- ============================================================
-- tempa_private.normalize_topic_text mirrors lib/interests.ts's own
-- normalizeTopicText exactly: lowercase, punctuation replaced with
-- spaces, whitespace collapsed. A curated alias then matches a
-- normalized Dispatch topic in one of two ways, mirroring lib/
-- interests.ts's matchTopicToInterests exactly:
--   - a multi-word alias (contains a space) matches only the WHOLE
--     normalized topic string, via plain equality;
--   - a single-word alias matches only as a whole TOKEN of the
--     normalized topic, via array membership on the space-split token
--     array.
-- Neither path is ever a substring scan (no LIKE/ILIKE/regex anywhere
-- in this matching logic) — "art" (a topic) matches the alias "art"
-- exactly, but "earth" (a topic, whose only token is "earth") can never
-- match it, regardless of "art" being a substring of "earth".
-- ============================================================

begin;

-- ============================================================
-- 1. INTERESTS — the curated taxonomy catalogue
-- ============================================================
create table public.interests (
  key text primary key,
  label text not null,
  position smallint not null unique
);

alter table public.interests enable row level security;

create policy interests_select_all
  on public.interests
  for select
  to authenticated
  using (true);

revoke all on public.interests from public, anon;
grant select on public.interests to authenticated;

insert into public.interests (key, label, position) values
  ('life-reflections', 'Life & Reflections', 1),
  ('family-parenting', 'Family & Parenting', 2),
  ('friendship', 'Friendship', 3),
  ('love-relationships', 'Love & Relationships', 4),
  ('spirituality-faith', 'Spirituality & Faith', 5),
  ('philosophy', 'Philosophy', 6),
  ('psychology', 'Psychology & Human Nature', 7),
  ('books-literature', 'Books & Literature', 8),
  ('writing-poetry', 'Writing & Poetry', 9),
  ('art-creativity', 'Art & Creativity', 10),
  ('music', 'Music', 11),
  ('film-tv', 'Film & Television', 12),
  ('travel-places', 'Travel & Places', 13),
  ('culture-society', 'Culture & Society', 14),
  ('history', 'History', 15),
  ('science-nature', 'Science & Nature', 16),
  ('technology', 'Technology', 17),
  ('work-ambition', 'Work & Ambition', 18),
  ('food-cooking', 'Food & Cooking', 19),
  ('health-wellbeing', 'Health & Wellbeing', 20),
  ('sport-fitness', 'Sport & Fitness', 21),
  ('everyday-life', 'Everyday Life', 22);


-- ============================================================
-- 2. INTEREST_TOPIC_ALIASES — the curated matching keyword table
-- ============================================================
-- Never exposed to any client — read only from inside board_feed_page
-- (SECURITY INVOKER, so `authenticated` still needs the SELECT grant
-- below to let that query succeed under its own role).
create table public.interest_topic_aliases (
  interest_key text not null references public.interests(key) on delete cascade,
  alias text not null,
  primary key (interest_key, alias)
);

alter table public.interest_topic_aliases enable row level security;

create policy interest_topic_aliases_select_all
  on public.interest_topic_aliases
  for select
  to authenticated
  using (true);

revoke all on public.interest_topic_aliases from public, anon;
grant select on public.interest_topic_aliases to authenticated;

insert into public.interest_topic_aliases (interest_key, alias) values
  ('life-reflections', 'life'), ('life-reflections', 'reflection'), ('life-reflections', 'reflections'),
  ('life-reflections', 'gratitude'), ('life-reflections', 'grief'), ('life-reflections', 'loss'),
  ('life-reflections', 'journal'), ('life-reflections', 'journaling'), ('life-reflections', 'growth'),
  ('life-reflections', 'healing'), ('life-reflections', 'change'), ('life-reflections', 'memory'),
  ('life-reflections', 'memories'), ('life-reflections', 'aging'), ('life-reflections', 'forgiveness'),
  ('life-reflections', 'boundaries'), ('life-reflections', 'loneliness'),

  ('family-parenting', 'family'), ('family-parenting', 'parenting'), ('family-parenting', 'parenthood'),
  ('family-parenting', 'motherhood'), ('family-parenting', 'fatherhood'), ('family-parenting', 'children'),
  ('family-parenting', 'kids'), ('family-parenting', 'siblings'), ('family-parenting', 'grandparents'),
  ('family-parenting', 'home life'),

  ('friendship', 'friendship'), ('friendship', 'friends'), ('friendship', 'best friend'),
  ('friendship', 'belonging'),

  ('love-relationships', 'love'), ('love-relationships', 'dating'), ('love-relationships', 'romance'),
  ('love-relationships', 'marriage'), ('love-relationships', 'relationships'), ('love-relationships', 'breakup'),
  ('love-relationships', 'heartbreak'), ('love-relationships', 'crush'), ('love-relationships', 'partner'),
  ('love-relationships', 'partners'), ('love-relationships', 'divorce'), ('love-relationships', 'intimacy'),
  ('love-relationships', 'husband'), ('love-relationships', 'husbands'), ('love-relationships', 'wife'),
  ('love-relationships', 'wives'), ('love-relationships', 'reconciliation'), ('love-relationships', 'separation'),
  ('love-relationships', 'marital conflict'), ('love-relationships', 'relationship conflict'),

  ('spirituality-faith', 'faith'), ('spirituality-faith', 'spirituality'), ('spirituality-faith', 'christianity'),
  ('spirituality-faith', 'bible'), ('spirituality-faith', 'prayer'), ('spirituality-faith', 'church'),
  ('spirituality-faith', 'islam'), ('spirituality-faith', 'judaism'), ('spirituality-faith', 'buddhism'),
  ('spirituality-faith', 'hinduism'), ('spirituality-faith', 'meditation'), ('spirituality-faith', 'god'),
  ('spirituality-faith', 'religion'), ('spirituality-faith', 'sacred'),

  ('philosophy', 'philosophy'), ('philosophy', 'ethics'), ('philosophy', 'meaning'),
  ('philosophy', 'existentialism'), ('philosophy', 'stoicism'), ('philosophy', 'metaphysics'),
  ('philosophy', 'morality'), ('philosophy', 'wisdom'),

  ('psychology', 'psychology'), ('psychology', 'mind'), ('psychology', 'emotions'),
  ('psychology', 'feelings'), ('psychology', 'therapy'), ('psychology', 'mental health'),
  ('psychology', 'human nature'), ('psychology', 'self'), ('psychology', 'identity'),
  ('psychology', 'anxiety'),

  ('books-literature', 'books'), ('books-literature', 'book'), ('books-literature', 'literature'),
  ('books-literature', 'novel'), ('books-literature', 'novels'), ('books-literature', 'reading'),
  ('books-literature', 'fiction'), ('books-literature', 'nonfiction'), ('books-literature', 'library'),
  ('books-literature', 'bookclub'), ('books-literature', 'book club'),

  ('writing-poetry', 'writing'), ('writing-poetry', 'poetry'), ('writing-poetry', 'poems'),
  ('writing-poetry', 'poem'), ('writing-poetry', 'journaling'), ('writing-poetry', 'essays'),
  ('writing-poetry', 'essay'), ('writing-poetry', 'storytelling'), ('writing-poetry', 'creative writing'),

  ('art-creativity', 'art'), ('art-creativity', 'painting'), ('art-creativity', 'drawing'),
  ('art-creativity', 'creativity'), ('art-creativity', 'design'), ('art-creativity', 'sculpture'),
  ('art-creativity', 'illustration'), ('art-creativity', 'photography'), ('art-creativity', 'crafts'),

  ('music', 'music'), ('music', 'songs'), ('music', 'song'), ('music', 'singing'),
  ('music', 'concerts'), ('music', 'guitar'), ('music', 'piano'), ('music', 'jazz'), ('music', 'hip hop'),

  ('film-tv', 'film'), ('film-tv', 'films'), ('film-tv', 'movies'), ('film-tv', 'movie'),
  ('film-tv', 'cinema'), ('film-tv', 'television'), ('film-tv', 'tv'), ('film-tv', 'series'),
  ('film-tv', 'documentary'),

  ('travel-places', 'travel'), ('travel-places', 'travelling'), ('travel-places', 'traveling'),
  ('travel-places', 'places'), ('travel-places', 'adventure'), ('travel-places', 'backpacking'),
  ('travel-places', 'wanderlust'), ('travel-places', 'abroad'), ('travel-places', 'roadtrip'),
  ('travel-places', 'road trip'),

  ('culture-society', 'culture'), ('culture-society', 'society'), ('culture-society', 'identity'),
  ('culture-society', 'immigration'), ('culture-society', 'diaspora'), ('culture-society', 'community'),
  ('culture-society', 'politics'), ('culture-society', 'social justice'), ('culture-society', 'language'),

  ('history', 'history'), ('history', 'historical'), ('history', 'heritage'),
  ('history', 'ancestry'), ('history', 'genealogy'), ('history', 'archaeology'),

  ('science-nature', 'science'), ('science-nature', 'nature'), ('science-nature', 'biology'),
  ('science-nature', 'physics'), ('science-nature', 'astronomy'), ('science-nature', 'space'),
  ('science-nature', 'animals'), ('science-nature', 'wildlife'), ('science-nature', 'environment'),
  ('science-nature', 'climate'), ('science-nature', 'gardening'),

  ('technology', 'technology'), ('technology', 'tech'), ('technology', 'software'),
  ('technology', 'coding'), ('technology', 'programming'), ('technology', 'internet'),
  ('technology', 'ai'), ('technology', 'gadgets'),

  ('work-ambition', 'work'), ('work-ambition', 'career'), ('work-ambition', 'business'),
  ('work-ambition', 'entrepreneurship'), ('work-ambition', 'startup'), ('work-ambition', 'startups'),
  ('work-ambition', 'ambition'), ('work-ambition', 'leadership'), ('work-ambition', 'productivity'),
  ('work-ambition', 'job'), ('work-ambition', 'jobs'),

  ('food-cooking', 'food'), ('food-cooking', 'cooking'), ('food-cooking', 'baking'),
  ('food-cooking', 'recipes'), ('food-cooking', 'recipe'), ('food-cooking', 'cuisine'),
  ('food-cooking', 'restaurants'), ('food-cooking', 'coffee'), ('food-cooking', 'wine'),

  ('health-wellbeing', 'health'), ('health-wellbeing', 'wellbeing'), ('health-wellbeing', 'wellness'),
  ('health-wellbeing', 'sleep'), ('health-wellbeing', 'mindfulness'), ('health-wellbeing', 'self care'),
  ('health-wellbeing', 'nutrition'),

  ('sport-fitness', 'sport'), ('sport-fitness', 'sports'), ('sport-fitness', 'fitness'),
  ('sport-fitness', 'running'), ('sport-fitness', 'football'), ('sport-fitness', 'soccer'),
  ('sport-fitness', 'basketball'), ('sport-fitness', 'yoga'), ('sport-fitness', 'gym'),

  ('everyday-life', 'everyday'), ('everyday-life', 'daily life'), ('everyday-life', 'routine'),
  ('everyday-life', 'home'), ('everyday-life', 'mundane'), ('everyday-life', 'ordinary');


-- ============================================================
-- 3. PROFILE_INTERESTS — one viewer's own selection
-- ============================================================
-- Direct-select, RPC-only-write — same shape as several existing
-- tables in this schema (e.g. kept_minds's own read/write split, though
-- that one allows direct writes too; this one is RPC-only for writes
-- specifically so a full-selection replace can be atomic — see
-- set_profile_interests below). No session-stability concern: unlike
-- Keep/correspondence, an Interest selection is never treated as a
-- relationship signal, so there is no "session cutoff" for it to
-- respect.
create table public.profile_interests (
  viewer_user_id uuid not null
    references auth.users(id)
    on delete cascade,

  interest_key text not null
    references public.interests(key)
    on delete cascade,

  created_at timestamptz not null default now(),

  primary key (viewer_user_id, interest_key)
);

alter table public.profile_interests enable row level security;

create policy profile_interests_select_own
  on public.profile_interests
  for select
  using (auth.uid() = viewer_user_id);

revoke all on public.profile_interests from public, anon, authenticated;
grant select on public.profile_interests to authenticated;


-- ============================================================
-- 4. SET_PROFILE_INTERESTS — atomic full-selection replace
-- ============================================================
create or replace function public.set_profile_interests(p_interest_keys text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin

  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if array_length(p_interest_keys, 1) is not null and array_length(p_interest_keys, 1) > 8 then
    raise exception 'You can select at most 8 interests.';
  end if;

  delete from public.profile_interests where viewer_user_id = auth.uid();

  insert into public.profile_interests (viewer_user_id, interest_key)
  select auth.uid(), key
  from unnest(coalesce(p_interest_keys, '{}'::text[])) as key;

end;
$function$;

revoke all on function public.set_profile_interests(text[]) from public;
grant execute on function public.set_profile_interests(text[]) to authenticated;


-- ============================================================
-- 5. TEMPA_PRIVATE.NORMALIZE_TOPIC_TEXT — mirrors lib/interests.ts
-- ============================================================
create or replace function tempa_private.normalize_topic_text(p_topic text)
returns text
language sql
security invoker
set search_path to 'pg_catalog'
stable
as $$
  select trim(
    regexp_replace(
      regexp_replace(lower(trim(p_topic)), '[^a-z0-9\s]', ' ', 'g'),
      '\s+', ' ', 'g'
    )
  )
$$;

-- Deliberately no revoke — called directly from board_feed_page below
-- under the querying `authenticated` role, same treatment as every
-- other tempa_private helper this schema already calls that way
-- (tempa_private.is_blocked_pair, tempa_private.author_content_
-- publicly_visible). tempa_private is not in Supabase's Exposed Schemas
-- list, so there is still no way to reach it directly as a client.


-- ============================================================
-- 6. BOARD_FEED_PAGE — CREATE OR REPLACE, SAME signature/RETURNS TABLE
-- ============================================================
-- Every line is identical to docs/sql/2026-09-26-board-personalization-
-- ranking.sql's own board_feed_page EXCEPT: one new CTE (topical_
-- matches), one new column on `classified` (is_topical_match), and the
-- three stream CTEs' own ORDER BY gaining one new tie-break column
-- between author_seq and seed_hash. No parameter added or removed, no
-- RETURNS TABLE column added or removed — see this file's own header
-- comment for why that is deliberate and load-bearing (Reading Trail V2
-- stays exactly as it was).
create or replace function public.board_feed_page(
  p_session_started_at timestamptz,
  p_seed text,
  p_limit integer default 12,
  p_cursor_seen_bucket smallint default null,
  p_cursor_rank_key numeric default null,
  p_cursor_seed_hash integer default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  author_id uuid,
  title text,
  body text,
  published_at timestamptz,
  moderation_status text,
  is_kept boolean,
  is_familiar boolean,
  seen_bucket smallint,
  rank_key numeric,
  seed_hash integer
)
language sql
security invoker
stable
set search_path to 'public'
as $$
  with eligible_global as (
    select d.id, d.author_id, d.title, d.body, d.published_at, d.moderation_status
    from public.dispatches d
    where d.status = 'published'
      and d.moderation_status = 'visible'
      and d.published_at <= p_session_started_at
    order by d.published_at desc
    limit 300
  ),

  familiar_authors as (
    select author_id, bool_or(is_kept) as is_kept
    from (
      select km.kept_user_id as author_id, true as is_kept
      from public.kept_minds km
      where km.viewer_user_id = auth.uid()
        and km.created_at < p_session_started_at
        and not tempa_private.is_blocked_pair(auth.uid(), km.kept_user_id)

      union all

      select
        (case when c.participant_low = auth.uid() then c.participant_high else c.participant_low end) as author_id,
        false as is_kept
      from public.correspondences c
      where c.status = 'active'
        and c.established_at is not null
        and c.established_at < p_session_started_at
        and (c.participant_low = auth.uid() or c.participant_high = auth.uid())
        and not tempa_private.is_blocked_pair(
          auth.uid(),
          case when c.participant_low = auth.uid() then c.participant_high else c.participant_low end
        )
    ) sources
    group by author_id
  ),

  familiar_augment as (
    select d.id, d.author_id, d.title, d.body, d.published_at, d.moderation_status
    from familiar_authors fa
    cross join lateral (
      select d2.id, d2.author_id, d2.title, d2.body, d2.published_at, d2.moderation_status
      from public.dispatches d2
      where d2.author_id = fa.author_id
        and d2.status = 'published'
        and d2.moderation_status = 'visible'
        and d2.published_at <= p_session_started_at
        and not exists (
          select 1 from public.dispatch_views dv
          where dv.viewer_id = auth.uid()
            and dv.dispatch_id = d2.id
            and dv.first_viewed_at < p_session_started_at
        )
      order by d2.published_at desc
      limit 2
    ) d
  ),

  combined_eligible as (
    select ce.*, hashtext(p_seed || ce.id::text) as seed_hash
    from (
      select * from eligible_global
      union
      select * from familiar_augment
    ) ce
  ),

  -- Phase 2B addition — the viewer's own selected Interests, read live
  -- (no session-stability rule: unlike Keep/correspondence, an Interest
  -- selection is never treated as a relationship signal).
  viewer_interests as (
    select interest_key
    from public.profile_interests
    where viewer_user_id = auth.uid()
  ),

  -- Phase 2B addition — exact token/phrase alias matching only, never a
  -- substring scan (see this file's own header comment). Empty when the
  -- viewer has selected no Interests, which is what makes the zero-
  -- interest degrade a structural consequence rather than a special case.
  topical_matches as (
    select distinct dt.dispatch_id
    from public.dispatch_topics dt
    join public.interest_topic_aliases ia
      on ia.alias = tempa_private.normalize_topic_text(dt.topic)
      or ia.alias = any(string_to_array(tempa_private.normalize_topic_text(dt.topic), ' '))
    join viewer_interests vi on vi.interest_key = ia.interest_key
  ),

  classified as (
    select
      ce.*,
      (case
        when exists (
          select 1 from public.dispatch_views dv
          where dv.viewer_id = auth.uid()
            and dv.dispatch_id = ce.id
            and dv.first_viewed_at < p_session_started_at
        ) then 1::smallint
        else 0::smallint
      end) as seen_bucket,
      coalesce(fa.is_kept, false) as is_kept,
      (fa.author_id is not null) as is_familiar,
      exists (select 1 from topical_matches tm where tm.dispatch_id = ce.id) as is_topical_match
    from combined_eligible ce
    left join familiar_authors fa on fa.author_id = ce.author_id
  ),

  author_diverse as (
    select
      c.*,
      row_number() over (partition by c.seen_bucket, c.author_id order by c.published_at desc) as author_seq
    from classified c
  ),

  -- ---- Level 1: Keep : second familiarity signal = 3 : 1, independently per seen_bucket ----
  -- Phase 2B: each stream's own tie-break gains one new column
  -- (topical_rank, 0=matched/1=unmatched) between author_seq and
  -- seed_hash. This can only ever reorder rows that already tied on
  -- author_seq — it cannot change a stream's size or the divisor math
  -- below, which depends only on each row's position within its own
  -- stream. See this file's own header comment for the zero-interest
  -- degrade proof.

  keep_ranked as (
    select
      id, seen_bucket, seed_hash,
      row_number() over (
        partition by seen_bucket
        order by author_seq, (case when is_topical_match then 0 else 1 end), seed_hash
      ) as stream_i
    from author_diverse
    where is_kept
  ),
  second_signal_ranked as (
    select
      id, seen_bucket, seed_hash,
      row_number() over (
        partition by seen_bucket
        order by author_seq, (case when is_topical_match then 0 else 1 end), seed_hash
      ) as stream_i
    from author_diverse
    where is_familiar and not is_kept
  ),
  familiar_merged as (
    select id, seen_bucket, seed_hash, ((2 * stream_i - 1)::numeric / 3.0) as kc_key from keep_ranked
    union all
    select id, seen_bucket, seed_hash, ((2 * stream_i - 1)::numeric / 1.0) as kc_key from second_signal_ranked
  ),
  familiar_ranked as (
    select
      fm.id, fm.seen_bucket,
      row_number() over (partition by fm.seen_bucket order by fm.kc_key, fm.seed_hash) as familiar_i
    from familiar_merged fm
  ),

  -- ---- Level 2: Familiar : Discovery = 1 : 1, unbiased, independently per seen_bucket ----

  discovery_ranked as (
    select
      id, seen_bucket, seed_hash,
      row_number() over (
        partition by seen_bucket
        order by author_seq, (case when is_topical_match then 0 else 1 end), seed_hash
      ) as stream_i
    from author_diverse
    where not is_familiar
  ),
  top_level as (
    select fr.id, fr.seen_bucket, (2 * fr.familiar_i - 1)::numeric as rank_key from familiar_ranked fr
    union all
    select dr.id, dr.seen_bucket, (2 * dr.stream_i - 1)::numeric as rank_key from discovery_ranked dr
  ),

  final as (
    select
      cl.id, cl.author_id, cl.title, cl.body, cl.published_at, cl.moderation_status,
      cl.is_kept, cl.is_familiar, cl.seen_bucket, cl.seed_hash,
      tl.rank_key
    from author_diverse cl
    join top_level tl on tl.id = cl.id
  )

  select
    f.id, f.author_id, f.title, f.body, f.published_at, f.moderation_status,
    f.is_kept, f.is_familiar, f.seen_bucket, f.rank_key, f.seed_hash
  from final f
  where
    p_cursor_seen_bucket is null
    or (f.seen_bucket, f.rank_key, f.seed_hash, f.id)
      > (p_cursor_seen_bucket, p_cursor_rank_key, p_cursor_seed_hash, p_cursor_id)
  order by f.seen_bucket, f.rank_key, f.seed_hash, f.id
  limit p_limit
$$;

-- Grants unchanged from Phase 2A — same signature, same posture.
revoke all on function public.board_feed_page(
  timestamptz, text, integer, smallint, numeric, integer, uuid
) from public;

grant execute on function public.board_feed_page(
  timestamptz, text, integer, smallint, numeric, integer, uuid
) to authenticated;

commit;
