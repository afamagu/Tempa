// Board Feed Foundation checkpoint (Phase 2A) — this repository cannot
// execute Postgres, so (same approach as blockUserOverloadMigration.test.ts
// and publishDispatchMigration.test.ts) the tracked SQL source text itself
// is inspected directly. Deliberately avoids any literal `\n` inside a
// toContain(...) string — Windows CRLF line endings mean a literal `\n`
// never matches the actual file text (see the sign-in/turnstile-widget
// tests' own history of this exact class of bug).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-22-board-feed-foundation.sql')

const sql = readFileSync(MIGRATION_PATH, 'utf8')

describe('board feed foundation migration source — preflight correction: transaction safety', () => {
  it('wraps the whole migration in a single explicit transaction, matching every other tracked migration', () => {
    const beginIndex = sql.indexOf('begin;')
    const commitIndex = sql.lastIndexOf('commit;')
    expect(beginIndex).toBeGreaterThan(-1)
    expect(commitIndex).toBeGreaterThan(beginIndex)
  })

  it('begin precedes the first DDL statement, and commit is the final statement in the file', () => {
    const beginIndex = sql.indexOf('begin;')
    const firstCreate = sql.indexOf('create or replace function tempa_private.author_content_publicly_visible')
    expect(beginIndex).toBeGreaterThan(-1)
    expect(firstCreate).toBeGreaterThan(beginIndex)
    // commit; is the last non-whitespace content in the file.
    expect(sql.trim().endsWith('commit;')).toBe(true)
  })

  it('drops the pre-existing dispatches_select_published policy before recreating it — CREATE POLICY has no OR REPLACE form', () => {
    const dropIndex = sql.indexOf('drop policy dispatches_select_published on public.dispatches;')
    const createIndex = sql.indexOf('create policy dispatches_select_published')
    expect(dropIndex).toBeGreaterThan(-1)
    expect(createIndex).toBeGreaterThan(dropIndex)
  })
})

describe('board feed foundation migration source — trust & safety read-visibility fix', () => {
  it('defines tempa_private.author_content_publicly_visible', () => {
    expect(sql).toContain('create or replace function tempa_private.author_content_publicly_visible(p_author_id uuid)')
  })

  it('excludes exactly suspended and banned — never restricted, never active', () => {
    expect(sql).toContain("not in ('suspended', 'banned')")
  })

  it('never mentions restricted in the new helper\'s own exclusion logic', () => {
    const start = sql.indexOf('create or replace function tempa_private.author_content_publicly_visible')
    const end = sql.indexOf('$$;', start)
    const body = sql.slice(start, end)
    expect(body).not.toContain("'restricted'")
  })

  it('reproduces dispatches_select_published with the new predicate added, preserving blocking, moderation, and the author-owns-it exception', () => {
    const start = sql.indexOf('create policy dispatches_select_published')
    const end = sql.indexOf(';', start)
    const policy = sql.slice(start, end)
    expect(policy).toContain('tempa_private.author_content_publicly_visible(author_id)')
    expect(policy).toContain('tempa_private.is_blocked_pair(auth.uid(), author_id)')
    expect(policy).toContain("moderation_status = 'visible'")
    expect(policy).toContain('or author_id = auth.uid()')
  })

  it('does NOT revoke the new helper\'s execute grant from authenticated — the RLS policy calls it directly under the querying role', () => {
    expect(sql).not.toContain('revoke all on function tempa_private.author_content_publicly_visible')
  })
})

describe('board feed foundation migration source — search_dispatches hard cap', () => {
  it('reproduces search_dispatches with a hard limit added', () => {
    const start = sql.indexOf('create or replace function public.search_dispatches')
    const end = sql.indexOf('$$;', start)
    const body = sql.slice(start, end)
    expect(body).toContain('limit 50')
    expect(body).toContain("d.status = 'published'")
    expect(body).toContain("d.moderation_status = 'visible'")
    expect(body).toContain('order by d.published_at desc')
  })

  it('remains security invoker, not security definer', () => {
    const start = sql.indexOf('create or replace function public.search_dispatches')
    const end = sql.indexOf('$$;', start)
    const body = sql.slice(start, end)
    expect(body).toContain('security invoker')
    expect(body).not.toContain('security definer')
  })
})

describe('board feed foundation migration source — session-stability correction (first_viewed_at)', () => {
  it('adds first_viewed_at as nullable first, before any backfill or default', () => {
    const addColumnIndex = sql.indexOf('alter table public.dispatch_views add column first_viewed_at timestamptz;')
    expect(addColumnIndex).toBeGreaterThan(-1)
    // Must NOT carry a default at the point it's added — a volatile
    // now() default here would stamp every pre-existing row with the
    // migration's own run-time instant, destroying exactly the
    // historical values the very next statement needs to backfill from.
    expect(sql).not.toContain('add column first_viewed_at timestamptz default')
    expect(sql).not.toContain('add column first_viewed_at timestamptz not null')
  })

  it('backfills first_viewed_at from each row\'s own existing viewed_at BEFORE any default/not-null is applied', () => {
    const addColumnIndex = sql.indexOf('alter table public.dispatch_views add column first_viewed_at timestamptz;')
    const backfillIndex = sql.indexOf('update public.dispatch_views set first_viewed_at = viewed_at')
    const defaultIndex = sql.indexOf('alter column first_viewed_at set default now()')
    const notNullIndex = sql.indexOf('alter column first_viewed_at set not null')
    expect(addColumnIndex).toBeGreaterThan(-1)
    expect(backfillIndex).toBeGreaterThan(addColumnIndex)
    expect(defaultIndex).toBeGreaterThan(backfillIndex)
    expect(notNullIndex).toBeGreaterThan(defaultIndex)
  })

  it('defines a BEFORE UPDATE trigger function that unconditionally re-asserts the OLD first_viewed_at', () => {
    expect(sql).toContain('create or replace function tempa_private.dispatch_views_preserve_first_viewed_at()')
    expect(sql).toContain('new.first_viewed_at := old.first_viewed_at;')
  })

  it('attaches the trigger to dispatch_views, before update, for each row', () => {
    expect(sql).toContain('before update on public.dispatch_views')
    expect(sql).toContain('for each row')
    expect(sql).toContain('execute function tempa_private.dispatch_views_preserve_first_viewed_at()')
  })
})

describe('board feed foundation migration source — board_feed_page', () => {
  function boardFeedPageBody(): string {
    const start = sql.indexOf('create or replace function public.board_feed_page')
    const end = sql.indexOf('revoke all on function public.board_feed_page', start)
    return sql.slice(start, end)
  }

  it('is security invoker, never security definer — it must inherit RLS, not bypass it', () => {
    const body = boardFeedPageBody()
    expect(body).toContain('security invoker')
    expect(body).not.toContain('security definer')
  })

  it('never uses random() for ordering', () => {
    expect(boardFeedPageBody()).not.toContain('random()')
  })

  it('uses a seeded, deterministic hashtext() tie-break, not a bare id order', () => {
    expect(boardFeedPageBody()).toContain("hashtext(p_seed || t.id::text)")
  })

  it('uses row_number() partitioned by tier and author_id for author diversity', () => {
    const body = boardFeedPageBody()
    expect(body).toContain('row_number() over (partition by t.tier, t.author_id order by t.published_at desc)')
  })

  it('enforces the Stability Rule: excludes anything published after session start', () => {
    expect(boardFeedPageBody()).toContain('d.published_at <= p_session_started_at')
  })

  it('enforces the Stability Rule: pins "seen" to BEFORE session start using the IMMUTABLE first_viewed_at, never mere row existence', () => {
    expect(boardFeedPageBody()).toContain('dv.first_viewed_at < p_session_started_at')
  })

  it('session-stability correction: never uses the MUTABLE viewed_at for tiering — that was the exact bug an independent review found', () => {
    expect(boardFeedPageBody()).not.toContain('dv.viewed_at < p_session_started_at')
  })

  it('pins the Keep-ADD direction to session start via kept_minds\' existing created_at column', () => {
    expect(boardFeedPageBody()).toContain('km.created_at < p_session_started_at')
  })

  it('caps the eligible pool before any ranking computation runs (bounded cost regardless of corpus size)', () => {
    const body = boardFeedPageBody()
    expect(body).toContain('limit 300')
  })

  it('uses real keyset pagination — a row-value comparison against the caller-supplied cursor, never OFFSET', () => {
    const body = boardFeedPageBody()
    expect(body).toContain('p_cursor_tier is null')
    expect(body).toContain('> (p_cursor_tier, p_cursor_author_seq, p_cursor_seed_hash, p_cursor_id)')
    expect(body).not.toContain('offset')
  })

  it('respects the caller-supplied page size', () => {
    expect(boardFeedPageBody()).toContain('limit p_limit')
  })

  it('is granted to authenticated only, never anon — Board is authenticated-only content', () => {
    expect(sql).toContain('grant execute on function public.board_feed_page(timestamptz, text, integer, integer, bigint, integer, uuid) to authenticated')
    expect(sql).not.toContain('to anon, authenticated')
  })
})

describe('board feed foundation migration source — no scope creep', () => {
  it('introduces no new table of any kind — no Replies, no Worth Reading, no impression table, no Postcard changes', () => {
    expect(sql).not.toContain('create table')
  })

  it('never mentions likes, votes, reactions, or a public count', () => {
    const lower = sql.toLowerCase()
    expect(lower).not.toContain('create table public.likes')
    expect(lower).not.toContain('create table public.votes')
    expect(lower).not.toContain('create table public.reactions')
  })
})
