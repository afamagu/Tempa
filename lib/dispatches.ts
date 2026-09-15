import type { SupabaseClient } from '@supabase/supabase-js'
import { letterPreviewText, isRichBody } from './letters'

const PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 10

/**
 * A Dispatch — one member's writing, deliberately offered to the wider
 * authenticated Tempa community, shown on The Board. See
 * docs/sql/2026-09-07-dispatches-and-board.sql for the table this reads/
 * writes (renamed, in place, from the earlier open_letters table — see
 * that migration's own doc comment for why it's an ALTER, not a
 * drop/recreate). Every row this app version creates is 'published'
 * immediately — there is no server-side draft state (see
 * lib/letter-editor-draft.ts's Dispatch draft scope for where drafting
 * actually lives).
 */
export type ModerationStatus = 'visible' | 'hidden'

export type Dispatch = {
  id: string
  authorId: string
  title: string
  body: string
  publishedAt: string
  /** Admin Phase 2A-1 — 'hidden' means TEMPA moderation suppressed this
   * Dispatch from every public/discovery surface. Every LISTING query
   * below (Board, Home, a profile's Dispatch list, search) already
   * filters this out entirely (never returned even to its own author —
   * a feed/browse context is never the "appropriate own/direct view"
   * hidden content is still reachable through); only a direct fetch by
   * id (getDispatchById) can return a hidden row at all, and only ever
   * to its own author (dispatches_select_published's RLS), so the
   * single-Dispatch reader can render the calm "Hidden by TEMPA" state
   * instead of the normal one. */
  moderationStatus: ModerationStatus
}

export type DispatchMoment = {
  id: string
  position: number
  /** A short-lived signed URL, resolved server-side per request — same
   * pattern as a private letter's photo Moment (lib/letters.ts's
   * getMomentsForLetters). Never a public URL. */
  imageUrl: string | null
}

/** A Dispatch plus what the browse/profile/Board surfaces need to show
 * about its author and topics — never more than the existing
 * public_profiles allowlist already exposes elsewhere. `authorCountry`
 * is the same plain country NAME already shown elsewhere (Recommended
 * Minds, the public profile's demographics line) — added here (Board
 * usability visual follow-up, 2026-09-09) only so a compact country
 * flag can be shown beside the author's identity; never city, region,
 * coordinates, or anything auth-provider-derived. */
export type DispatchListItem = Dispatch & {
  authorPseudonym: string
  authorCountry: string | null
  topics: string[]
}

/** One Board row, with the per-viewer signal Board ordering needs.
 * `seen`/`kept` are never shown in any UI as a count — they only ever
 * decide sort position (see sortBoardDispatches). */
export type BoardDispatch = DispatchListItem & {
  seen: boolean
  kept: boolean
}

type DispatchRow = {
  id: string
  author_id: string
  title: string
  body: string
  published_at: string
  moderation_status: ModerationStatus
}

function toDispatch(row: DispatchRow): Dispatch {
  return {
    id: row.id,
    authorId: row.author_id,
    title: row.title,
    body: row.body,
    publishedAt: row.published_at,
    moderationStatus: row.moderation_status,
  }
}

/**
 * Pure: the same paragraph-aware, marker-stripped preview convention
 * every other Tempa writing surface already uses (Letterbox, Home's
 * Arrivals) — reused as-is for the Dispatch excerpt shown alongside its
 * title, rather than inventing a second excerpt rule.
 */
export function dispatchExcerpt(body: string): string {
  return letterPreviewText(body)
}

/** Whether a Dispatch's body should be run through FormattedText's
 * mark-decoding — same isRichBody rule every letter/answer body uses. */
export function dispatchIsRich(body: string): boolean {
  return isRichBody(body)
}

const TITLE_MAX_CHARS = 70

/**
 * Pure: the composer's own title validation, mirroring
 * publish_dispatch's server-side checks exactly (blank, then length) so
 * the client can give immediate feedback without a round trip — the
 * server remains the actual authority regardless (see the SQL
 * migration's own RAISE EXCEPTION messages, worded identically).
 */
export function dispatchTitleError(title: string): string | null {
  if (title.trim().length === 0) return 'A Dispatch needs a title.'
  if (title.length > TITLE_MAX_CHARS) return 'Title is too long.'
  return null
}

const TOPIC_MAX_CHARS = 40
const TOPIC_MAX_COUNT = 3

/**
 * Pure: trims, drops blanks, deduplicates case-insensitively (keeping
 * the FIRST casing seen), clips an over-length tag defensively, and
 * caps the result at 3 — the same normalization publish_dispatch
 * performs server-side (never trusted from the client alone; this
 * exists so the composer's chip list matches what will actually be
 * saved, not to replace that server-side check).
 */
export function normalizeTopics(input: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const raw of input) {
    const trimmed = raw.trim().slice(0, TOPIC_MAX_CHARS)
    if (trimmed.length === 0) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
    if (result.length >= TOPIC_MAX_COUNT) break
  }

  return result
}

/**
 * Pure: Board's three-tier order —
 *   1. unseen Dispatches from kept minds
 *   2. unseen Dispatches from everyone else
 *   3. previously seen Dispatches
 * newest-first within each tier, never a popularity signal (none of
 * these inputs carry one). Tier 1 is passed through interleaveByAuthor
 * first so one prolific kept author can't occupy the whole first
 * screen — the only "ranking" this performs is that fixed, deliberate
 * anti-starvation reordering, never a score.
 */
export function sortBoardDispatches<
  T extends { seen: boolean; kept: boolean; authorId: string; publishedAt: string },
>(items: T[]): T[] {
  const byNewest = (a: T, b: T) => b.publishedAt.localeCompare(a.publishedAt)

  const unseenKept = items.filter((i) => !i.seen && i.kept).sort(byNewest)
  const unseenOthers = items.filter((i) => !i.seen && !i.kept).sort(byNewest)
  const previouslySeen = items.filter((i) => i.seen).sort(byNewest)

  return [...interleaveByAuthor(unseenKept), ...unseenOthers, ...previouslySeen]
}

/**
 * Pure: a round-robin reorder that keeps consecutive same-author items
 * apart wherever the pool allows it — one prolific kept writer's five
 * Dispatches spread across the tier instead of occupying its first five
 * slots, without any score, weighting, or engagement signal. Stable for
 * a single author (their own relative newest-first order is preserved).
 */
export function interleaveByAuthor<T extends { authorId: string }>(items: T[]): T[] {
  const byAuthor = new Map<string, T[]>()
  const order: string[] = []
  for (const item of items) {
    if (!byAuthor.has(item.authorId)) {
      byAuthor.set(item.authorId, [])
      order.push(item.authorId)
    }
    byAuthor.get(item.authorId)!.push(item)
  }

  const result: T[] = []
  let remaining = items.length
  while (remaining > 0) {
    for (const authorId of order) {
      const queue = byAuthor.get(authorId)!
      if (queue.length === 0) continue
      result.push(queue.shift()!)
      remaining -= 1
    }
  }
  return result
}

const LIST_COLUMNS = 'id, author_id, title, body, published_at, moderation_status'
const BROWSE_LIMIT = 60

async function attachTopicsAndAuthors(
  supabase: SupabaseClient,
  rows: DispatchRow[]
): Promise<DispatchListItem[]> {
  if (rows.length === 0) return []

  const dispatchIds = rows.map((r) => r.id)
  const authorIds = [...new Set(rows.map((r) => r.author_id))]

  const [{ data: profiles }, { data: topicRows }] = await Promise.all([
    supabase.from('public_profiles').select('id, pseudonym, country').in('id', authorIds),
    supabase.from('dispatch_topics').select('dispatch_id, topic').in('dispatch_id', dispatchIds),
  ])

  const profileById = new Map(
    (profiles ?? []).map((p) => [p.id, p as { id: string; pseudonym: string; country: string | null }])
  )
  const topicsByDispatchId = new Map<string, string[]>()
  for (const row of (topicRows ?? []) as { dispatch_id: string; topic: string }[]) {
    const arr = topicsByDispatchId.get(row.dispatch_id) ?? []
    arr.push(row.topic)
    topicsByDispatchId.set(row.dispatch_id, arr)
  }

  return rows.map((row) => ({
    ...toDispatch(row),
    authorPseudonym: profileById.get(row.author_id)?.pseudonym ?? 'A member',
    authorCountry: profileById.get(row.author_id)?.country ?? null,
    topics: topicsByDispatchId.get(row.id) ?? [],
  }))
}

/**
 * Every currently published, currently visible Dispatch, newest first —
 * the raw pool The Board's viewer-aware ordering (sortBoardDispatches)
 * is applied to. RLS (dispatches_select_published) is the real
 * enforcement of "published only"; the explicit status filter here is
 * defense in depth, not the security boundary itself. The explicit
 * `moderation_status = 'visible'` filter is NOT merely defense in depth
 * though (Admin Phase 2A-1): RLS's own author-exception would otherwise
 * let a member's OWN hidden Dispatch resurface in their OWN general
 * Board browse, mixed in with everyone else's — a feed/browse context
 * is never the "appropriate own/direct view" hidden content should
 * stay reachable through (see getDispatchById for that instead).
 */
export async function getPublishedDispatches(supabase: SupabaseClient): Promise<DispatchListItem[]> {
  const { data: rows } = await supabase
    .from('dispatches')
    .select(LIST_COLUMNS)
    .eq('status', 'published')
    .eq('moderation_status', 'visible')
    .order('published_at', { ascending: false })
    .limit(BROWSE_LIMIT)

  return attachTopicsAndAuthors(supabase, (rows ?? []) as DispatchRow[])
}

/**
 * Home Phase 1 (Editorial Reading Surface) — internal candidate pool
 * size, NOT the number of cards Home renders. Comfortably covers every
 * section's own max (Featured 3 + Shelf 5 + From Minds You Keep 3 +
 * Serendipity 3 = 14) with a little headroom for sections that can't
 * fill (e.g. too few Kept-author rows), without ever needing a second
 * round trip. Still just a `limit` on the same board_feed_page RPC —
 * no new ranking, no new RPC.
 */
export const HOME_CANDIDATE_COUNT = 20

/**
 * Home's candidate pool for its editorial Board reading surface — a
 * thin wrapper over getBoardFeedPage, the SAME tiering/author-diversity
 * core The Board itself uses, one page, no cursor. Mints ONE fresh
 * session_started_at/seed per Home render (Home still has no persisted
 * browsing-session concept — see getBoardFeedPage's own doc comment)
 * and returns it alongside the items, so every Dispatch link Home
 * builds from this SAME candidate set can encode that session via
 * readingTrailSearchParams, keeping Continue Reading consistent for
 * the whole render without persisting anything new to the DB.
 * Partitioning this pool into sections is the caller's job
 * (partitionHomeSections) — this function only ever fetches.
 */
export async function getHomeBoardCandidates(
  supabase: SupabaseClient
): Promise<{ items: BoardFeedItem[]; sessionStartedAt: string; seed: string }> {
  const sessionStartedAt = new Date().toISOString()
  const seed = generateBoardSeed()
  const { items } = await getBoardFeedPage(supabase, {
    sessionStartedAt,
    seed,
    cursor: null,
    limit: HOME_CANDIDATE_COUNT,
  })
  return { items, sessionStartedAt, seed }
}

export type HomeSections = {
  featured: BoardFeedItem[]
  shelf: BoardFeedItem[]
  fromMindsYouKeep: BoardFeedItem[]
  serendipity: BoardFeedItem[]
  /** Left over after every section above has claimed its rows — not a
   * section of its own; ON THE BOARD's ambient title strip draws from
   * this first (falling back to reusing already-placed titles only if
   * the candidate pool was too small to leave anything over), so the
   * strip's titles are genuinely distinct from the cards above it
   * whenever the pool allows. */
  remainder: BoardFeedItem[]
}

const HOME_FEATURED_COUNT = 3
const HOME_SHELF_COUNT = 5
const HOME_KEEP_SECTION_MAX = 3
const HOME_SERENDIPITY_MAX = 3

/**
 * Pure: deterministic section partitioning over an ALREADY-ranked
 * board_feed_page candidate pool — never re-ranks, never invents a new
 * ranking algorithm, and never lets the same Dispatch id appear in more
 * than one section (the one hard product rule this function exists to
 * guarantee). Order among candidates is preserved throughout — each
 * section simply claims the next eligible unused rows in that existing
 * order. Degrades gracefully (a shorter or entirely omitted section)
 * rather than ever duplicating a card when the pool runs out; the
 * caller (app/home/page.tsx) is responsible for omitting a rendered
 * section entirely once it's empty (From Minds You Keep in particular
 * is expected to often be empty and must vanish cleanly, not render a
 * heading over nothing).
 *
 * Section order matches the product contract exactly: Featured claims
 * first, then the Shelf, then From Minds You Keep (tier 1 only), then
 * Serendipity (non-kept, preferring tier 2 — a Phase-1 proxy for
 * broader discovery only, never a claim about being "outside the
 * member's interests," which don't exist yet).
 */
export function partitionHomeSections(items: BoardFeedItem[]): HomeSections {
  const used = new Set<string>()

  const featured = items.slice(0, HOME_FEATURED_COUNT)
  for (const item of featured) used.add(item.id)

  const shelf: BoardFeedItem[] = []
  for (const item of items) {
    if (shelf.length >= HOME_SHELF_COUNT) break
    if (used.has(item.id)) continue
    shelf.push(item)
    used.add(item.id)
  }

  const fromMindsYouKeep: BoardFeedItem[] = []
  for (const item of items) {
    if (fromMindsYouKeep.length >= HOME_KEEP_SECTION_MAX) break
    if (used.has(item.id) || item.tier !== 1) continue
    fromMindsYouKeep.push(item)
    used.add(item.id)
  }

  const serendipity: BoardFeedItem[] = []
  function fillSerendipity(matchesPreference: (item: BoardFeedItem) => boolean) {
    for (const item of items) {
      if (serendipity.length >= HOME_SERENDIPITY_MAX) break
      if (used.has(item.id) || item.tier === 1 || !matchesPreference(item)) continue
      serendipity.push(item)
      used.add(item.id)
    }
  }
  // Prefer tier 2 (unseen, non-kept); only fall back to tier 3
  // (previously seen) once tier 2 is exhausted — never tier 1 (kept),
  // which stays exclusive to the section above.
  fillSerendipity((item) => item.tier === 2)
  fillSerendipity(() => true)

  const remainder = items.filter((item) => !used.has(item.id))

  return { featured, shelf, fromMindsYouKeep, serendipity, remainder }
}

// ============================================================
// READING TRAIL — zero-DB-state "Continue Reading" (Home Phase 1)
// ============================================================
//
// A Dispatch link built from an already-ranked board_feed_page result
// (Home's candidate pool, or The Board's own feed) carries that
// result's session (sessionStartedAt/seed) plus the LINKED item's own
// keyset cursor as plain URL query params — nothing persisted anywhere.
// The Dispatch detail page, when it finds valid trail params, asks
// board_feed_page (via getNextTrailItems below) for exactly the next
// rows after that cursor in that exact session/ordering, and renders a
// small "Continue Reading" shelf — each card's OWN href carries the
// same session plus ITS OWN cursor, so picking any one of them (not
// just the first) keeps the trail extending correctly from THAT item
// onward. A bare `/board/[id]` URL (direct link, shared link, a search
// result) simply has none of these params, so no trail is ever
// manufactured for it.

const TRAIL_PARAM_KEYS = {
  sessionStartedAt: 's',
  seed: 'seed',
  tier: 'tier',
  authorSeq: 'aseq',
  seedHash: 'shash',
} as const

/**
 * Encodes one Dispatch link's reading-trail context — the session this
 * candidate came from, plus this item's own (tier, author_seq,
 * seed_hash) cursor. The item's own id is deliberately NOT included
 * here: it's already the `/board/[dispatchId]` route param the caller
 * is linking to, so the Dispatch detail page recovers it from its own
 * route params rather than duplicating it into the query string.
 */
export function readingTrailSearchParams(
  session: { sessionStartedAt: string; seed: string },
  item: BoardFeedItem
): URLSearchParams {
  const params = new URLSearchParams()
  params.set(TRAIL_PARAM_KEYS.sessionStartedAt, session.sessionStartedAt)
  params.set(TRAIL_PARAM_KEYS.seed, session.seed)
  params.set(TRAIL_PARAM_KEYS.tier, String(item.tier))
  params.set(TRAIL_PARAM_KEYS.authorSeq, String(item.cursor.authorSeq))
  params.set(TRAIL_PARAM_KEYS.seedHash, String(item.cursor.seedHash))
  return params
}

export type ReadingTrailContext = {
  sessionStartedAt: string
  seed: string
  tier: number
  authorSeq: number
  seedHash: number
}

/**
 * Pure: parses the Dispatch detail page's own searchParams back into a
 * trail context — returns null (never throws) for anything absent or
 * malformed, since an absent/broken trail simply means no Continue
 * Reading block renders, exactly like a bare direct/shared URL.
 */
export function parseReadingTrailParams(
  searchParams: Record<string, string | string[] | undefined>
): ReadingTrailContext | null {
  const get = (key: string): string | undefined => {
    const value = searchParams[key]
    return typeof value === 'string' ? value : undefined
  }

  const sessionStartedAt = get(TRAIL_PARAM_KEYS.sessionStartedAt)
  const seed = get(TRAIL_PARAM_KEYS.seed)
  const tier = Number(get(TRAIL_PARAM_KEYS.tier))
  const authorSeq = Number(get(TRAIL_PARAM_KEYS.authorSeq))
  const seedHash = Number(get(TRAIL_PARAM_KEYS.seedHash))

  if (!sessionStartedAt || !seed) return null
  if (!Number.isFinite(tier) || !Number.isFinite(authorSeq) || !Number.isFinite(seedHash)) return null

  return { sessionStartedAt, seed, tier, authorSeq, seedHash }
}

/** Home Phase 1B — the "Continue Reading" shelf shows up to this many
 * subsequent trail items, never just one. */
export const CONTINUE_READING_COUNT = 4

/**
 * Up to `count` rows immediately after `context`'s own cursor, in that
 * context's exact session/ordering — a plain getBoardFeedPage call
 * with `limit: count`, no new RPC. `currentDispatchId` completes the
 * keyset cursor (board_feed_page's own tuple comparison needs it as
 * the final tie-break) — it comes from the caller's own route param,
 * never from the URL query string (see readingTrailSearchParams's own
 * comment). Returns fewer than `count` (down to zero) once the trail
 * reaches the end of the session's ordering — never an error, the
 * caller simply renders a smaller shelf, or none at all.
 */
export async function getNextTrailItems(
  supabase: SupabaseClient,
  context: ReadingTrailContext,
  currentDispatchId: string,
  count: number = CONTINUE_READING_COUNT
): Promise<BoardFeedItem[]> {
  const { items } = await getBoardFeedPage(supabase, {
    sessionStartedAt: context.sessionStartedAt,
    seed: context.seed,
    cursor: { tier: context.tier, authorSeq: context.authorSeq, seedHash: context.seedHash, id: currentDispatchId },
    limit: count,
  })
  return items
}

// ============================================================
// BOARD FEED — Board Feed Foundation checkpoint (Phase 2A)
// ============================================================

/** Opaque-to-callers cursor for board_feed_page's keyset pagination —
 * the (tier, author_seq, seed_hash, id) tuple of the last row already
 * returned. Carries no meaning outside another getBoardFeedPage call. */
export type BoardFeedCursor = {
  tier: number
  authorSeq: number
  seedHash: number
  id: string
}

/** One board_feed_page row, WITH the per-viewer ranking/cursor
 * information the RPC already computes and previously discarded after
 * mapping — Home Phase 1 needs `tier` to partition sections (From
 * Minds You Keep = tier 1, Serendipity prefers tier 2) and `cursor`
 * (this row's OWN tier/author_seq/seed_hash) to build a reading-trail
 * link for it (see readingTrailSearchParams below). `cursor.id` always
 * equals this item's own `id`. */
export type BoardFeedItem = DispatchListItem & {
  tier: number
  cursor: BoardFeedCursor
}

export const BOARD_FEED_PAGE_SIZE = 12

/** A short, non-secret, per-browsing-session random string — the seed
 * fed into board_feed_page's deterministic hashtext() tie-break. Not a
 * security token: it only ever decides display order, never anything
 * access-related, so plain Math.random() (visible in the Board URL,
 * exactly as the checkpoint spec calls for) is intentional, not an
 * oversight. */
export function generateBoardSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}

type BoardFeedRow = DispatchRow & {
  tier: number
  author_seq: number
  seed_hash: number
}

/**
 * One page of The Board's session-stable, cursor-paginated,
 * author-diverse feed — see docs/sql/2026-09-22-board-feed-
 * foundation.sql's own extensive comment on board_feed_page for the
 * full reasoning (session model, the exact viewed_at-based stability
 * rule, author_seq's diversity+recency unification, the seeded
 * hashtext() tie-break, and why this is real keyset pagination, never
 * OFFSET). This function's own job is thin: call the RPC, attach
 * authors/topics via the same batched helper every other Dispatch
 * listing already uses, and turn the last row's own (tier, author_seq,
 * seed_hash, id) into the next page's cursor.
 *
 * `sessionStartedAt`/`seed` must be the SAME two values for every call
 * within one Board browsing session (including every "Load more") —
 * carried by the caller (the Board page's own URL), never persisted
 * here or anywhere else. A `cursor` of `null` always means "first page
 * of this session," never "first page ever."
 */
export async function getBoardFeedPage(
  supabase: SupabaseClient,
  params: {
    sessionStartedAt: string
    seed: string
    cursor: BoardFeedCursor | null
    limit?: number
  }
): Promise<{ items: BoardFeedItem[]; nextCursor: BoardFeedCursor | null }> {
  const limit = params.limit ?? BOARD_FEED_PAGE_SIZE

  const { data: rows } = await supabase.rpc('board_feed_page', {
    p_session_started_at: params.sessionStartedAt,
    p_seed: params.seed,
    p_limit: limit,
    p_cursor_tier: params.cursor?.tier ?? null,
    p_cursor_author_seq: params.cursor?.authorSeq ?? null,
    p_cursor_seed_hash: params.cursor?.seedHash ?? null,
    p_cursor_id: params.cursor?.id ?? null,
  })

  const typedRows = (rows ?? []) as BoardFeedRow[]
  const listItems = await attachTopicsAndAuthors(supabase, typedRows)
  const cursorByRowId = new Map(
    typedRows.map((row) => [
      row.id,
      { tier: row.tier, authorSeq: row.author_seq, seedHash: row.seed_hash, id: row.id },
    ])
  )
  // attachTopicsAndAuthors preserves row order/count 1:1, so this zip is
  // safe — kept as an id-keyed lookup regardless, rather than assuming
  // index alignment, so it can never silently misattach a cursor.
  const items: BoardFeedItem[] = listItems.map((item) => {
    const cursor = cursorByRowId.get(item.id)!
    return { ...item, tier: cursor.tier, cursor }
  })

  const last = typedRows[typedRows.length - 1]
  const nextCursor: BoardFeedCursor | null =
    typedRows.length === limit && last
      ? { tier: last.tier, authorSeq: last.author_seq, seedHash: last.seed_hash, id: last.id }
      : null

  return { items, nextCursor }
}

/**
 * One author's published, visible Dispatches, newest first — the
 * profile-integration list (app/minds/[userId]/page.tsx). Same RLS/
 * defense-in-depth reasoning as getPublishedDispatches, including the
 * explicit moderation_status filter — a hidden Dispatch never appears
 * in this list even when the profile's own owner is viewing it.
 */
export async function getPublishedDispatchesByAuthor(
  supabase: SupabaseClient,
  authorId: string
): Promise<DispatchListItem[]> {
  const { data: rows } = await supabase
    .from('dispatches')
    .select(LIST_COLUMNS)
    .eq('author_id', authorId)
    .eq('status', 'published')
    .eq('moderation_status', 'visible')
    .order('published_at', { ascending: false })

  return attachTopicsAndAuthors(supabase, (rows ?? []) as DispatchRow[])
}

/** Title + topics + body — title deliberately weighted no differently
 * than body/topics here (no ranking); a plain OR across all three via
 * the search_dispatches RPC. */
export async function searchDispatches(
  supabase: SupabaseClient,
  query: string
): Promise<DispatchListItem[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []

  const { data: rows } = await supabase.rpc('search_dispatches', { p_query: trimmed })
  return attachTopicsAndAuthors(supabase, (rows ?? []) as DispatchRow[])
}

/**
 * One Dispatch for the reader — returns null both when no row with this
 * id exists at all AND when RLS hides an unpublished/hidden one that
 * isn't the viewer's own (the cases are indistinguishable from the
 * client side by design; the reader treats them all as notFound()).
 *
 * Admin Phase 2A-1: deliberately the ONE Dispatch fetcher that does NOT
 * filter out a hidden row — dispatches_select_published's RLS already
 * only ever returns a hidden Dispatch to its own author (`or author_id
 * = auth.uid()`), so this is exactly the "appropriate own/direct view"
 * Decision 2 describes. The caller (app/board/[dispatchId]/page.tsx)
 * checks `moderationStatus` itself and renders the calm "Hidden by
 * TEMPA" state instead of the normal reading view for that one case.
 */
export async function getDispatchById(
  supabase: SupabaseClient,
  id: string
): Promise<DispatchListItem | null> {
  const { data } = await supabase.from('dispatches').select(LIST_COLUMNS).eq('id', id).maybeSingle()
  if (!data) return null

  const items = await attachTopicsAndAuthors(supabase, [data as DispatchRow])
  return items[0] ?? null
}

/**
 * Every still-image Moment attached to one Dispatch, position order —
 * the reading counterpart to lib/letters.ts's getMomentsForLetters,
 * against the SEPARATE dispatch-photos bucket/table (never the private
 * letter-photos one — see the migration's own doc comment for why).
 */
export async function getDispatchMoments(
  supabase: SupabaseClient,
  dispatchId: string
): Promise<DispatchMoment[]> {
  const { data } = await supabase
    .from('dispatch_moments')
    .select('id, position, image_path')
    .eq('dispatch_id', dispatchId)
    .order('position', { ascending: true })

  const rows = (data ?? []) as { id: string; position: number; image_path: string }[]
  if (rows.length === 0) return []

  const paths = [...new Set(rows.map((r) => r.image_path))]
  const { data: signed } = await supabase.storage
    .from('dispatch-photos')
    .createSignedUrls(paths, PHOTO_SIGNED_URL_TTL_SECONDS)

  const signedUrlByPath = new Map<string, string>()
  for (const s of signed ?? []) {
    if (s.signedUrl && s.path) signedUrlByPath.set(s.path, s.signedUrl)
  }

  return rows.map((row) => ({
    id: row.id,
    position: row.position,
    imageUrl: signedUrlByPath.get(row.image_path) ?? null,
  }))
}

/**
 * Just the FIRST (lowest-position) still-image Moment's signed URL per
 * Dispatch, batched — what the Home shelf and Board cards need for
 * their one small thumbnail, never the full per-paragraph set
 * getDispatchMoments resolves for the reader.
 */
export async function getFirstMomentThumbnails(
  supabase: SupabaseClient,
  dispatchIds: string[]
): Promise<Map<string, string>> {
  if (dispatchIds.length === 0) return new Map()

  const { data } = await supabase
    .from('dispatch_moments')
    .select('dispatch_id, position, image_path')
    .in('dispatch_id', dispatchIds)
    .order('position', { ascending: true })

  const rows = (data ?? []) as { dispatch_id: string; position: number; image_path: string }[]
  const firstPathByDispatchId = new Map<string, string>()
  for (const row of rows) {
    if (!firstPathByDispatchId.has(row.dispatch_id)) firstPathByDispatchId.set(row.dispatch_id, row.image_path)
  }
  if (firstPathByDispatchId.size === 0) return new Map()

  const paths = [...new Set(firstPathByDispatchId.values())]
  const { data: signed } = await supabase.storage.from('dispatch-photos').createSignedUrls(paths, 60 * 10)
  const signedUrlByPath = new Map<string, string>()
  for (const s of signed ?? []) {
    if (s.signedUrl && s.path) signedUrlByPath.set(s.path, s.signedUrl)
  }

  const result = new Map<string, string>()
  for (const [dispatchId, path] of firstPathByDispatchId) {
    const url = signedUrlByPath.get(path)
    if (url) result.set(dispatchId, url)
  }
  return result
}

/**
 * Every still-image Moment attached to one Dispatch, WITH its raw
 * storage path alongside a resolved signed preview URL — needed only
 * for reloading a Dispatch back into the editable composer
 * (lib/letter-editor-doc.ts's dispatchBodyToDoc), which must reattach each
 * photoMoment node's real imagePath (never just its preview URL, since
 * that's what re-publishing/re-editing sends back to update_dispatch).
 * getDispatchMoments (the reader's own fetcher) deliberately never
 * exposes the raw path to keep that surface minimal — this is a
 * separate, edit-only fetcher rather than widening that one.
 */
export async function getDispatchMomentsForEditing(
  supabase: SupabaseClient,
  dispatchId: string
): Promise<{ position: number; imagePath: string; previewUrl: string | null }[]> {
  const { data } = await supabase
    .from('dispatch_moments')
    .select('position, image_path')
    .eq('dispatch_id', dispatchId)
    .order('position', { ascending: true })

  const rows = (data ?? []) as { position: number; image_path: string }[]
  if (rows.length === 0) return []

  const paths = [...new Set(rows.map((r) => r.image_path))]
  const { data: signed } = await supabase.storage
    .from('dispatch-photos')
    .createSignedUrls(paths, PHOTO_SIGNED_URL_TTL_SECONDS)

  const signedUrlByPath = new Map<string, string>()
  for (const s of signed ?? []) {
    if (s.signedUrl && s.path) signedUrlByPath.set(s.path, s.signedUrl)
  }

  return rows.map((row) => ({
    position: row.position,
    imagePath: row.image_path,
    previewUrl: signedUrlByPath.get(row.image_path) ?? null,
  }))
}

export type PublishDispatchError = { message: string; code?: string; details?: string; hint?: string } | null

export type DispatchMomentDraft = { position: number; imagePath: string }

/**
 * Publishes a Dispatch (title, body, up to 3 topics, still-image
 * Moments) via the publish_dispatch RPC — one atomic transaction, same
 * reasoning as publish_question_answer: a Dispatch must never be left
 * with only some of its topics/Moments inserted if validation fails
 * partway through.
 */
export async function publishDispatch(
  supabase: SupabaseClient,
  input: { title: string; body: string; topics: string[]; moments?: DispatchMomentDraft[] }
): Promise<{ data: Dispatch | null; error: PublishDispatchError }> {
  const { data, error } = await supabase.rpc('publish_dispatch', {
    p_title: input.title,
    p_body: input.body,
    p_topics: normalizeTopics(input.topics),
    p_moments: (input.moments ?? []).map((m) => ({ position: m.position, type: 'photo', image_path: m.imagePath })),
  })

  if (error) {
    // Diagnostic checkpoint (2026-09-08): details/hint were previously
    // dropped here, so even a correctly-logged failure only ever showed
    // a bare message/code — the composer's dev-mode error detail (see
    // dispatch-composer.tsx) needs all four PostgrestError fields to be
    // useful.
    return { data: null, error: { message: error.message, code: error.code, details: error.details, hint: error.hint } }
  }

  return { data: toDispatch(data as DispatchRow), error: null }
}

/**
 * Edits an already-published Dispatch in place via update_dispatch —
 * same id, same publish date, never a new external share token (the
 * RPC never touches dispatch_shares). Author-only, re-validated
 * server-side exactly like publish_dispatch's own checks. Title/topics/
 * Moments are wholesale replaced, not diffed — see the SQL migration's
 * own comment for why that's the simplest correct approach here.
 */
export async function updateDispatch(
  supabase: SupabaseClient,
  dispatchId: string,
  input: { title: string; body: string; topics: string[]; moments?: DispatchMomentDraft[] }
): Promise<{ data: Dispatch | null; error: PublishDispatchError }> {
  const { data, error } = await supabase.rpc('update_dispatch', {
    p_dispatch_id: dispatchId,
    p_title: input.title,
    p_body: input.body,
    p_topics: normalizeTopics(input.topics),
    p_moments: (input.moments ?? []).map((m) => ({ position: m.position, type: 'photo', image_path: m.imagePath })),
  })

  if (error) {
    return { data: null, error: { message: error.message, code: error.code, details: error.details, hint: error.hint } }
  }

  return { data: toDispatch(data as DispatchRow), error: null }
}

export type DeleteDispatchError = { message: string; code?: string } | null

/**
 * Deletes a Dispatch permanently via delete_dispatch (author-only;
 * topics/Moments metadata/views/its share row all cascade at the
 * database level). Does NOT remove the underlying storage image
 * objects — callers must do that separately (see
 * app/board/[dispatchId]/author-actions-menu.tsx) using the image paths
 * they already hold from BEFORE calling this, since the Moment rows
 * naming those paths are gone the instant this succeeds.
 *
 * Board Experience Phase 2B pre-SQL correction: delete_dispatch now
 * refuses to delete a Dispatch that still has any Reply row (its own
 * author's or another member's), returning the exact message "This
 * Dispatch cannot be deleted while it still has Replies." — Replies are
 * never cascade-deleted alongside their Dispatch.
 */
export async function deleteDispatch(
  supabase: SupabaseClient,
  dispatchId: string
): Promise<{ error: DeleteDispatchError }> {
  const { error } = await supabase.rpc('delete_dispatch', { p_dispatch_id: dispatchId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

// ============================================================
// KEEP IN MIND
// ============================================================

/** Whether the viewer currently Keeps this person in mind — private to
 * the viewer; RLS (kept_minds_own) means the kept person themselves can
 * never query this about anyone who kept THEM. */
export async function isKeepingMind(
  supabase: SupabaseClient,
  viewerId: string,
  keptUserId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('kept_minds')
    .select('viewer_user_id')
    .eq('viewer_user_id', viewerId)
    .eq('kept_user_id', keptUserId)
    .maybeSingle()

  return data !== null
}

/** Every user id this viewer currently Keeps — used by Board ordering,
 * never displayed as a list/count to anyone else. */
export async function getKeptUserIds(supabase: SupabaseClient, viewerId: string): Promise<Set<string>> {
  const { data } = await supabase.from('kept_minds').select('kept_user_id').eq('viewer_user_id', viewerId)
  return new Set((data ?? []).map((r) => r.kept_user_id as string))
}

export type KeepMindError = { message: string; code?: string } | null

/**
 * Safety & Trust Checkpoint 1B: kept_minds mutation is now RPC-only
 * (docs/sql/2026-09-11-safety-blocking-foundation.sql, section 8) —
 * `authenticated`'s direct INSERT/DELETE grant on kept_minds was
 * revoked, since a hostile client could otherwise bypass any block
 * check placed only in application code by writing the row directly.
 * `keep_mind` itself enforces self/block/account-status server-side;
 * the ON CONFLICT DO NOTHING inside it already makes a duplicate Keep
 * a silent success, so there is no longer a 23505 case for this
 * function to special-case the way the old direct-insert version did.
 * `viewerId` is kept as a parameter only for call-site compatibility —
 * the RPC itself derives the actual actor from auth.uid() server-side,
 * never from a client-supplied id.
 */
export async function keepMind(
  supabase: SupabaseClient,
  viewerId: string,
  keptUserId: string
): Promise<{ error: KeepMindError }> {
  if (viewerId === keptUserId) {
    return { error: { message: 'You cannot Keep yourself in mind.' } }
  }

  const { error } = await supabase.rpc('keep_mind', { p_kept_user_id: keptUserId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

/** De-escalating — remains available regardless of block state or
 * account status (Checkpoint 1B), matching unkeep_mind's own design. */
export async function unkeepMind(
  supabase: SupabaseClient,
  viewerId: string,
  keptUserId: string
): Promise<{ error: KeepMindError }> {
  const { error } = await supabase.rpc('unkeep_mind', { p_kept_user_id: keptUserId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

// ============================================================
// VIEWED / RESUME STATE
// ============================================================

export type DispatchViewState = { lastParagraphIndex: number }

/** Whether this viewer has ever opened this Dispatch at all — the
 * "seen" half of Board ordering; never exposed to the author. */
export async function hasSeenDispatch(
  supabase: SupabaseClient,
  viewerId: string,
  dispatchId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('dispatch_views')
    .select('viewer_id')
    .eq('viewer_id', viewerId)
    .eq('dispatch_id', dispatchId)
    .maybeSingle()

  return data !== null
}

/** Every Dispatch id this viewer has ever opened — used by Board
 * ordering in one batched read rather than one query per row. */
export async function getSeenDispatchIds(supabase: SupabaseClient, viewerId: string): Promise<Set<string>> {
  const { data } = await supabase.from('dispatch_views').select('dispatch_id').eq('viewer_id', viewerId)
  return new Set((data ?? []).map((r) => r.dispatch_id as string))
}

/** The stored resume position for one viewer/Dispatch pair, or null if
 * they've never opened it. `lastParagraphIndex` is clamped by the
 * reader against the Dispatch's ACTUAL current paragraph count before
 * use — see clampReadingPosition — never trusted as in-range on its
 * own (a Dispatch's body cannot change after publish today, but the
 * clamp costs nothing and remains correct if that ever changes). */
export async function getDispatchViewState(
  supabase: SupabaseClient,
  viewerId: string,
  dispatchId: string
): Promise<DispatchViewState | null> {
  const { data } = await supabase
    .from('dispatch_views')
    .select('last_paragraph_index')
    .eq('viewer_id', viewerId)
    .eq('dispatch_id', dispatchId)
    .maybeSingle()

  return data ? { lastParagraphIndex: data.last_paragraph_index as number } : null
}

/** Pure: never restores to a paragraph that no longer exists — the
 * reader always has somewhere valid to land, even if a stored position
 * from before is now out of range. */
export function clampReadingPosition(storedIndex: number, paragraphCount: number): number {
  if (paragraphCount <= 0) return 0
  return Math.min(Math.max(storedIndex, 0), paragraphCount - 1)
}

/**
 * Silently records reading progress — no Save Bookmark action anywhere
 * calls this; the reader itself calls it as the member scrolls. Upsert
 * rather than insert-then-update: the first call for a Dispatch and
 * every later one use the exact same statement.
 */
export async function recordDispatchProgress(
  supabase: SupabaseClient,
  viewerId: string,
  dispatchId: string,
  lastParagraphIndex: number
): Promise<void> {
  await supabase.from('dispatch_views').upsert({
    viewer_id: viewerId,
    dispatch_id: dispatchId,
    last_paragraph_index: lastParagraphIndex,
    viewed_at: new Date().toISOString(),
  })
}

// ============================================================
// SHARING — external, unauthenticated reading of one Dispatch
// ============================================================
//
// Three distinct states, never conflated: PUBLISHED (dispatches.status
// = 'published', visible to any authenticated member on the Board),
// SHARED (a live dispatch_shares row exists — the author deliberately
// tapped Share), and PRIVATE CORRESPONDENCE (letters have no equivalent
// anywhere — nothing below is reachable from, or references, any
// letter/correspondence code). See docs/tempa-build-guide.md's
// "Dispatch sharing / external reading" section for the full record.

export type DispatchShare = { id: string; dispatchId: string; revokedAt: string | null }

function toDispatchShare(row: { id: string; dispatch_id: string; revoked_at: string | null }): DispatchShare {
  return { id: row.id, dispatchId: row.dispatch_id, revokedAt: row.revoked_at }
}

/**
 * The Dispatch's current live share, if any — a plain SELECT, permitted
 * only for the Dispatch's own author (dispatch_shares_select_own's
 * RLS). Used solely to render "Share" vs "Sharing • Stop sharing"
 * state on page load without calling the mutating share_dispatch RPC
 * just to check it; never used to decide whether sharing is allowed —
 * share_dispatch/revoke_dispatch_share re-validate that themselves.
 */
export async function getActiveDispatchShare(
  supabase: SupabaseClient,
  dispatchId: string
): Promise<DispatchShare | null> {
  const { data } = await supabase
    .from('dispatch_shares')
    .select('id, dispatch_id, revoked_at')
    .eq('dispatch_id', dispatchId)
    .is('revoked_at', null)
    .maybeSingle()

  return data ? toDispatchShare(data as { id: string; dispatch_id: string; revoked_at: string | null }) : null
}

export type ShareDispatchError = { message: string; code?: string } | null

/**
 * Creates, or reuses if one is already live, this Dispatch's external
 * share token — via share_dispatch, the ONLY way a share row is ever
 * created (there is no direct INSERT grant against dispatch_shares from
 * the client; see the migration's own grant/RLS design). Never
 * generates a token client-side.
 */
export async function shareDispatch(
  supabase: SupabaseClient,
  dispatchId: string
): Promise<{ data: DispatchShare | null; error: ShareDispatchError }> {
  const { data, error } = await supabase.rpc('share_dispatch', { p_dispatch_id: dispatchId })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  return {
    data: toDispatchShare(data as { id: string; dispatch_id: string; revoked_at: string | null }),
    error: null,
  }
}

/**
 * "Stop sharing externally" — revokes the Dispatch's current live share
 * via revoke_dispatch_share. A no-op, not an error, if none exists.
 * Never touches the Dispatch row itself — publication status and Board
 * visibility are both unaffected.
 */
export async function revokeDispatchShare(
  supabase: SupabaseClient,
  dispatchId: string
): Promise<{ error: ShareDispatchError }> {
  const { error } = await supabase.rpc('revoke_dispatch_share', { p_dispatch_id: dispatchId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

export type SharedDispatch = {
  id: string
  title: string
  body: string
  publishedAt: string
  authorPseudonym: string
  /** The author's plain country name, same allowlisted field
   * public_profiles already exposes elsewhere — null until
   * get_shared_dispatch's return shape is widened to include it (see
   * docs/sql/2026-09-10-shared-dispatch-country.sql, prepared but NOT
   * executed) and this stays null for every caller regardless. Never
   * city/region/coordinates. */
  authorCountry: string | null
  topics: string[]
  moments: DispatchMoment[]
}

type SharedDispatchRpcRow = {
  dispatch_id: string
  title: string
  body: string
  published_at: string
  author_pseudonym: string
  /** Optional: only present once/if the SQL migration above is applied.
   * Older RPC rows simply won't carry this key. */
  author_country?: string | null
  topics: string[]
  moments: { id: string; position: number; image_path: string }[]
}

/**
 * The SOLE data path for the unauthenticated external reader
 * (/d/[shareToken]) — everything it needs, in one RPC call. Never a
 * direct query against dispatches/dispatch_topics/dispatch_moments/
 * public_profiles/kept_minds/dispatch_views: get_shared_dispatch itself
 * (SECURITY DEFINER, validates the token and the Dispatch's published
 * status server-side) is the entire trust boundary. This function's own
 * job is just shaping that one row and resolving each Moment's storage
 * path into a short-lived signed URL — the same
 * `storage.from('dispatch-photos').createSignedUrls` call
 * getDispatchMoments already makes for the authenticated reader, here
 * authorized instead by the share-scoped dispatch_photos_select_shared
 * policy. Deliberately does not distinguish an invalid token, a revoked
 * one, and one whose Dispatch is no longer published — all three come
 * back as null, matching get_shared_dispatch's own zero-rows contract.
 */
const DEV_DIAGNOSTICS = process.env.NODE_ENV !== 'production'

/**
 * Live-test diagnosis (2026-09-10): a read-only database/policy audit
 * confirmed the entire external-sharing SQL contract (SECURITY DEFINER
 * functions, hardened search_path, anon execute grants, the private
 * dispatch-photos bucket, its anon-scoped SELECT policy, RLS on every
 * Dispatch table, the one-active-share index) is correctly LIVE — so
 * the earlier "the storage policy probably isn't applied" hypothesis is
 * retired. These logs instead trace the actual runtime data through
 * every stage of this function, server-side only (this function only
 * ever runs in a Server Component — see app/d/[shareToken]/page.tsx —
 * so nothing here reaches the browser), so the real break point can be
 * read directly off the dev server's own log output on the next live
 * test. Deliberately never logs: the Dispatch body text, any signed
 * URL in full (only whether one was produced, never the token embedded
 * in it), auth/session tokens, email addresses, or raw image bytes.
 */
function logStage(stage: string, detail: unknown) {
  if (!DEV_DIAGNOSTICS) return
  console.log(`[getSharedDispatch] ${stage}:`, detail)
}

export async function getSharedDispatch(
  supabase: SupabaseClient,
  shareToken: string
): Promise<SharedDispatch | null> {
  const { data, error: rpcError } = await supabase.rpc('get_shared_dispatch', { p_token: shareToken })
  const row = ((data ?? []) as SharedDispatchRpcRow[])[0]

  // Stage 1: does get_shared_dispatch return a row at all, and does
  // that row carry the Moment(s) we expect?
  logStage('1. RPC response', {
    rpcError: rpcError ? { message: rpcError.message, code: rpcError.code } : null,
    rowCount: (data ?? []).length,
    dispatchId: row?.dispatch_id ?? null,
    momentCount: row?.moments?.length ?? 0,
  })

  if (!row) return null

  // Stage 2: the returned moments array's exact structural shape —
  // ids/positions/paths, so a wrong column, a null path, or an
  // unexpected type is visible directly.
  logStage(
    '2. returned moments (structural)',
    row.moments.map((m) => ({ id: m.id, position: m.position, image_path: m.image_path }))
  )

  const paths = [...new Set(row.moments.map((m) => m.image_path))]
  const signedUrlByPath = new Map<string, string>()
  if (paths.length > 0) {
    // Stage 3: exactly what createSignedUrls is being asked to sign.
    logStage('3. paths sent to createSignedUrls', paths)

    const { data: signed, error: signError } = await supabase.storage
      .from('dispatch-photos')
      .createSignedUrls(paths, PHOTO_SIGNED_URL_TTL_SECONDS)

    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) signedUrlByPath.set(s.path, s.signedUrl)
    }

    // Stage 4/5: the signing call's result — never the signed URL
    // itself (it embeds a short-lived access token), only whether one
    // came back per path, plus the exact per-path and call-level error
    // (message/status) when one occurred.
    logStage('4-5. createSignedUrls result', {
      callLevelError: signError
        ? { message: signError.message, name: signError.name, status: (signError as { status?: number }).status }
        : null,
      perPath: (signed ?? []).map((s) => ({
        path: s.path,
        gotSignedUrl: Boolean(s.signedUrl),
        itemError: (s as { error?: string | null }).error ?? null,
      })),
    })
  }

  const mappedMoments = [...row.moments]
    .sort((a, b) => a.position - b.position)
    .map((m) => ({ id: m.id, position: m.position, imageUrl: signedUrlByPath.get(m.image_path) ?? null }))

  // Stage 6: the exact shape handed back to the caller (SharedDispatchView,
  // via app/d/[shareToken]/page.tsx) — confirms the signed-URL mapping
  // survived into the value the component tree actually receives.
  logStage(
    '6. final moments passed to SharedDispatchView',
    mappedMoments.map((m) => ({ id: m.id, position: m.position, hasImageUrl: Boolean(m.imageUrl) }))
  )

  return {
    id: row.dispatch_id,
    title: row.title,
    body: row.body,
    publishedAt: row.published_at,
    authorPseudonym: row.author_pseudonym,
    authorCountry: row.author_country ?? null,
    topics: row.topics,
    moments: mappedMoments,
  }
}

// ============================================================
// PIN TO PROFILE — at most one pinned Dispatch per member
// ============================================================

export type PinDispatchError = { message: string; code?: string } | null

/** Pins this Dispatch to the caller's own public profile via
 * pin_dispatch — author-only, published-only, and a single UPDATE on
 * profiles.pinned_dispatch_id, so pinning a different Dispatch
 * atomically replaces whatever was pinned before. Never a count,
 * never a ranking signal. */
export async function pinDispatch(
  supabase: SupabaseClient,
  dispatchId: string
): Promise<{ error: PinDispatchError }> {
  const { error } = await supabase.rpc('pin_dispatch', { p_dispatch_id: dispatchId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

/** Clears the caller's own pinned Dispatch, if any — a no-op, not an
 * error, if nothing was pinned. */
export async function unpinDispatch(supabase: SupabaseClient): Promise<{ error: PinDispatchError }> {
  const { error } = await supabase.rpc('unpin_dispatch')
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

/**
 * The Dispatch a given profile currently has pinned, if any — reads
 * public_profiles.pinned_dispatch_id (the same curated, cross-user-safe
 * view every other profile field goes through) and, only if set,
 * resolves the actual Dispatch via getDispatchById. Returns null both
 * when nothing is pinned and when a pinned id somehow fails to resolve
 * (e.g. mid-transaction) — the public profile page simply omits the
 * section either way, never a broken "Pinned" heading with nothing
 * under it.
 *
 * Admin Phase 2A-1: also returns null for a HIDDEN pinned Dispatch,
 * even when the profile's own owner is the one viewing it —
 * getDispatchById's own RLS-driven author-exception would otherwise
 * let it through here, but a "Pinned" card on a profile is a feed/
 * browse-style surface (same reasoning as the Board/Home/profile-list
 * filters above), never the "appropriate own/direct view" hidden
 * content should stay reachable through.
 */
export async function getPinnedDispatch(
  supabase: SupabaseClient,
  authorId: string
): Promise<DispatchListItem | null> {
  const { data } = await supabase
    .from('public_profiles')
    .select('pinned_dispatch_id')
    .eq('id', authorId)
    .maybeSingle()

  const pinnedId = (data as { pinned_dispatch_id: string | null } | null)?.pinned_dispatch_id
  if (!pinnedId) return null

  const dispatch = await getDispatchById(supabase, pinnedId)
  if (!dispatch || dispatch.moderationStatus === 'hidden') return null
  return dispatch
}
