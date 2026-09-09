-- Tempa — Search Migration 2: the search_letterbox RPC.
-- PREPARED 2026-09-03. NOT EXECUTED — review, then run in the Supabase
-- SQL editor, AFTER 2026-09-03-letters-body-search.sql (confirmed live
-- and verified: letters.body_search + letters_body_search_idx exist).
--
-- No UI, no API route, no application code, no historical data
-- touched — this is the RPC only. letters_for_participant is
-- untouched; this queries public.letters directly (SECURITY DEFINER),
-- the same pattern every write RPC in this project already uses
-- (send_first_letter, reply_to_letter, write_letter,
-- mark_letter_opened), because full-text ranking/highlighting needs
-- access to body_search and raw body directly, which the view doesn't
-- (and shouldn't) expose.
--
-- search_path is fixed to 'pg_catalog' only — NOT 'public' — so every
-- single Tempa object this function touches must be (and is) written
-- with an explicit public.* qualification; nothing resolves implicitly
-- against an attacker-influenceable search_path. Built-in functions/
-- types used here (trim, coalesce, least, greatest, lower, replace,
-- websearch_to_tsquery, ts_headline, ts_rank, the regconfig/tsquery
-- types, the built-in 'simple' text search configuration) all live in
-- pg_catalog itself, so they resolve correctly unqualified under this
-- search_path with no special-casing needed. auth.uid() is likewise
-- always schema-qualified.
--
-- Schemas this was written against (verified from actual migration
-- history, not assumed):
--   correspondences(id, participant_low, participant_high, status,
--     created_at, closed_at, established_at)
--   correspondence_hidden_for_user(user_id, correspondence_id, hidden_at)
--     — primary key (user_id, correspondence_id)
--   letters(id, sender_id, recipient_id, correspondence_id, body,
--     body_search, created_at, ...)
--   profiles(id, pseudonym, ...) — pseudonym uniqueness already
--     enforced elsewhere (pseudonym_key); not re-derived here.
--
-- Episode-visibility predicate verified against the actual current
-- implementations of getLetterboxPeople / getLetterArchiveWithUser
-- (lib/letters.ts), not assumed: both functions use exactly one
-- visibility rule — the caller is a participant on the correspondence
-- (participant_low/participant_high) AND that correspondence has no
-- row for this caller in correspondence_hidden_for_user. Neither
-- function applies any additional filter for status ('active' vs
-- 'closed') or established_at — a closed, or still-unestablished/
-- unaccepted first-contact, correspondence is fully visible in normal
-- Letterbox as long as it isn't manually hidden. The predicate below
-- (participant check + not exists correspondence_hidden_for_user)
-- matches that exactly, applied identically to both the People and
-- Letters branches — there is no separate/stricter rule to replicate.

begin;

create or replace function public.search_letterbox(
  p_query text,
  p_people_limit int default 5,
  p_letters_limit int default 20,
  p_letters_offset int default 0
)
returns table (
  kind text,
  person_id uuid,
  pseudonym text,
  letter_id uuid,
  correspondence_id uuid,
  other_pseudonym text,
  created_at timestamptz,
  excerpt text,
  rank real
)
language plpgsql
security definer
set search_path to 'pg_catalog'
stable
as $function$

declare
  v_uid uuid := auth.uid();
  v_query text := trim(coalesce(p_query, ''));
  -- Wildcard-escaped form of v_query for use inside ILIKE patterns
  -- only — never for equality comparisons (an exact-match check must
  -- compare against the member's literal, unescaped pseudonym text).
  -- Escaping order matters: the escape character itself must be
  -- doubled FIRST, before introducing new backslashes for % and _, or
  -- those newly-introduced backslashes would themselves get escaped
  -- again on a later step.
  v_escaped_query text;
  -- Hard maximums — never trust the caller's requested counts as-is.
  -- People: the candidate set is already bounded by how many people
  -- this member has ever corresponded with, so 20 is generous, not
  -- a real limit in practice. Letters: 50 keeps a single response
  -- bounded regardless of mailbox size; offset is clamped too, purely
  -- defensively, so a pathological value can't force an unbounded scan.
  v_people_limit int := least(greatest(coalesce(p_people_limit, 5), 1), 20);
  v_letters_limit int := least(greatest(coalesce(p_letters_limit, 20), 1), 50);
  v_letters_offset int := least(greatest(coalesce(p_letters_offset, 0), 0), 10000);
  v_tsquery tsquery;

begin

  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  -- Empty/whitespace-only query: zero rows, not "everything." No
  -- further work needed — RETURN with no RETURN QUERY exits the
  -- set-returning function having emitted nothing.
  if v_query = '' then
    return;
  end if;

  v_escaped_query := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');

  -- websearch_to_tsquery is deliberately used instead of to_tsquery:
  -- it is documented to accept arbitrary user input (unbalanced
  -- quotes, stray operators, punctuation-only strings) WITHOUT raising
  -- a syntax error — to_tsquery would throw on malformed input, which
  -- is exactly the "avoidable FTS exception" this must not produce.
  -- Computed once and reused for @@, ts_rank, and ts_headline so all
  -- three agree on exactly the same parsed query.
  v_tsquery := websearch_to_tsquery('simple'::regconfig, v_query);

  return query
  with people as (
    -- Every DISTINCT other participant across every correspondence
    -- episode visible to this caller (not hidden) — deduplicated
    -- BEFORE the profile join and BEFORE the pseudonym filter, so a
    -- person with multiple episodes (an old closed one, a later new
    -- one) appears exactly once here, exactly like Letterbox Level 1.
    -- This CTE's own ORDER BY + LIMIT decides WHICH people win a slot;
    -- the outer query below separately guarantees the final row order.
    select
      'person'::text as kind,
      p.id as person_id,
      p.pseudonym,
      null::uuid as letter_id,
      null::uuid as correspondence_id,
      null::text as other_pseudonym,
      null::timestamptz as created_at,
      null::text as excerpt,
      null::real as rank
    from (
      select distinct
        case when c.participant_low = v_uid then c.participant_high else c.participant_low end as other_id
      from public.correspondences c
      where (c.participant_low = v_uid or c.participant_high = v_uid)
        and not exists (
          select 1 from public.correspondence_hidden_for_user h
          where h.correspondence_id = c.id and h.user_id = v_uid
        )
    ) candidates
    join public.profiles p on p.id = candidates.other_id
    where p.pseudonym ilike ('%' || v_escaped_query || '%') escape '\'
    order by
      (lower(p.pseudonym) = lower(v_query)) desc,                       -- exact match first
      (p.pseudonym ilike (v_escaped_query || '%') escape '\') desc,     -- then prefix match
      p.pseudonym asc,                                                  -- deterministic fallback
      p.id asc                                                          -- absolute tiebreak
    limit v_people_limit
  ),
  letters as (
    -- Only letters where the caller is sender or recipient, and whose
    -- correspondence is not hidden for the caller — both evaluated
    -- here, server-side, from v_uid alone. A letter can never be
    -- returned merely because it matched the text; it must ALSO pass
    -- this predicate on every single row. This CTE's own ORDER BY +
    -- LIMIT/OFFSET decides WHICH letters win a slot; the outer query
    -- below separately guarantees the final row order.
    --
    -- The inner select is wrapped and its ORDER BY qualified as
    -- letter_candidates.* deliberately: RETURNS TABLE's output columns
    -- (including `rank`) become plpgsql variables visible throughout
    -- this function body, and a BARE `rank`/`created_at` reference
    -- here would be ambiguous against those variables rather than
    -- unambiguously naming this select's own column. A table-qualified
    -- reference is never subject to that shadowing, so every ordering
    -- expression below is qualified — never a bare alias.
    select *
    from (
      select
        'letter'::text as kind,
        null::uuid as person_id,
        null::text as pseudonym,
        l.id as letter_id,
        l.correspondence_id,
        other_p.pseudonym as other_pseudonym,
        l.created_at,
        ts_headline(
          'simple'::regconfig,
          l.body,
          v_tsquery,
          'StartSel=⟦⟦, StopSel=⟧⟧, MaxWords=20, MinWords=6, ShortWord=3, HighlightAll=false'
        ) as excerpt,
        ts_rank(l.body_search, v_tsquery) as rank
      from public.letters l
      join public.profiles other_p
        on other_p.id = case when l.sender_id = v_uid then l.recipient_id else l.sender_id end
      where (l.sender_id = v_uid or l.recipient_id = v_uid)
        and l.body_search @@ v_tsquery
        and not exists (
          select 1 from public.correspondence_hidden_for_user h
          where h.correspondence_id = l.correspondence_id and h.user_id = v_uid
        )
    ) letter_candidates
    order by
      letter_candidates.rank desc,
      letter_candidates.created_at desc,
      letter_candidates.letter_id asc  -- deterministic tiebreak, matching the outer ordering
    limit v_letters_limit
    offset v_letters_offset
  ),
  combined as (
    select * from people
    union all
    select * from letters
  )
  -- The UNION ALL above guarantees nothing about final row order on
  -- its own — this outer SELECT is what actually guarantees it:
  -- people as a group before letters as a group, each internally
  -- ordered by the same rule its own CTE used to pick winners, down
  -- to an absolute id-based tiebreak. Every ordering expression here
  -- draws only from the 9 public columns (plus the in-scope v_query),
  -- so the RETURNS TABLE contract itself never changes.
  select
    combined.kind,
    combined.person_id,
    combined.pseudonym,
    combined.letter_id,
    combined.correspondence_id,
    combined.other_pseudonym,
    combined.created_at,
    combined.excerpt,
    combined.rank
  from combined
  order by
    (combined.kind = 'letter') asc,                                                 -- people group first
    (lower(combined.pseudonym) = lower(v_query)) desc nulls last,                    -- person: exact match first
    (combined.pseudonym ilike (v_escaped_query || '%') escape '\') desc nulls last,  -- person: prefix match next
    combined.pseudonym asc nulls last,                                              -- person: alphabetical fallback
    combined.person_id asc nulls last,                                              -- person: absolute tiebreak
    combined.rank desc nulls last,                                                  -- letter: relevance
    combined.created_at desc nulls last,                                            -- letter: recency
    combined.letter_id asc nulls last;                                              -- letter: absolute tiebreak

end;
$function$;

-- Explicit, idempotent privilege reset — safe to re-run regardless of
-- whatever privilege state existed before this migration (a prior
-- partial run, a manual grant, default owner grants, etc.). Each role
-- is revoked individually rather than relying solely on "revoke from
-- public" to imply the rest, since a direct grant to a specific role
-- is not guaranteed to be un-done by revoking PUBLIC alone.
revoke all
on function public.search_letterbox(text, int, int, int)
from public;

revoke all
on function public.search_letterbox(text, int, int, int)
from anon;

revoke all
on function public.search_letterbox(text, int, int, int)
from authenticated;

grant execute
on function public.search_letterbox(text, int, int, int)
to authenticated;

commit;
