import type { SupabaseClient } from '@supabase/supabase-js'
import { letterPreviewText, isRichBody } from './letters'
import type { LetterPostcardDraft, PostcardBaseContent, PostcardRevealLineAlignment } from './moments'

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

// Smoke-test contract completion checkpoint — doubled from the original
// 70, mirroring publish_dispatch's AND update_dispatch's own
// char_length(p_title) > 140 checks exactly (docs/sql/2026-09-28-title-
// postcard-and-edit-window.sql). A single shared value: create and edit
// have always used, and continue to use, the exact same ceiling.
const TITLE_MAX_CHARS = 140

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
 * Serendipity 3 = 14) with headroom for sections that can't fill (e.g.
 * too few Kept-author rows) and for the relationship-aware ranking's own
 * unseen-first/familiar-interleave shape, without ever needing a second
 * round trip. Raised from 20 to 30 (Board Personalization checkpoint) —
 * still just a `limit` on the same board_feed_page RPC, no new ranking,
 * no new RPC.
 */
export const HOME_CANDIDATE_COUNT = 30

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
 * first, then the Shelf, then From Minds You Keep (isKept only — a
 * correspondent-only author never qualifies), then Serendipity
 * (isFamiliar === false only — never backfilled with a familiar author
 * just to reach the target count; a proxy for broader discovery only,
 * never a claim about being "outside the member's interests," which
 * don't exist yet).
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

  // Keep-only, per the approved architecture — an author who is merely
  // an established correspondent (isFamiliar true, isKept false) never
  // qualifies for this section, even though they're otherwise treated as
  // familiar for ranking purposes.
  const fromMindsYouKeep: BoardFeedItem[] = []
  for (const item of items) {
    if (fromMindsYouKeep.length >= HOME_KEEP_SECTION_MAX) break
    if (used.has(item.id) || !item.isKept) continue
    fromMindsYouKeep.push(item)
    used.add(item.id)
  }

  // isFamiliar === false only — never backfilled with a familiar
  // (Kept or correspondent) author just to reach the target count, per
  // the approved architecture. The feed itself is already unseen-first,
  // so this naturally prefers unseen material without any extra logic
  // here.
  const serendipity: BoardFeedItem[] = []
  for (const item of items) {
    if (serendipity.length >= HOME_SERENDIPITY_MAX) break
    if (used.has(item.id) || item.isFamiliar) continue
    serendipity.push(item)
    used.add(item.id)
  }

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

/** Reading Trail v2 (Board Personalization checkpoint) — retires the
 * old tier/author_seq-based cursor fields (`tier`, `aseq`, `shash`)
 * entirely in favor of the new (seen_bucket, rank_key, seed_hash)
 * cursor board_feed_page now returns. `v` is an explicit version marker
 * so an old, unversioned trail URL (from before this checkpoint) always
 * parses to null rather than being silently misinterpreted against the
 * new field meanings. */
const READING_TRAIL_VERSION = 2

const TRAIL_PARAM_KEYS = {
  sessionStartedAt: 's',
  seed: 'seed',
  version: 'v',
  seenBucket: 'sb',
  rankKey: 'rk',
  seedHash: 'sh',
} as const

/**
 * Encodes one Dispatch link's reading-trail context — the session this
 * candidate came from, plus this item's own (seen_bucket, rank_key,
 * seed_hash) cursor. `rank_key` is carried as an opaque STRING
 * throughout — never parsed into a JS number anywhere in this file or
 * any caller — since it is a PostgreSQL `numeric` value that may not
 * round-trip losslessly through JS's own number type. The item's own id
 * is deliberately NOT included here: it's already the
 * `/board/[dispatchId]` route param the caller is linking to, so the
 * Dispatch detail page recovers it from its own route params rather than
 * duplicating it into the query string. Never carries `isKept`/
 * `isFamiliar` or any other relationship signal — those stay purely
 * server-side/internal to ranking, per the minimal-exposure requirement.
 */
export function readingTrailSearchParams(
  session: { sessionStartedAt: string; seed: string },
  item: BoardFeedItem
): URLSearchParams {
  const params = new URLSearchParams()
  params.set(TRAIL_PARAM_KEYS.sessionStartedAt, session.sessionStartedAt)
  params.set(TRAIL_PARAM_KEYS.seed, session.seed)
  params.set(TRAIL_PARAM_KEYS.version, String(READING_TRAIL_VERSION))
  params.set(TRAIL_PARAM_KEYS.seenBucket, String(item.cursor.seenBucket))
  params.set(TRAIL_PARAM_KEYS.rankKey, item.cursor.rankKey)
  params.set(TRAIL_PARAM_KEYS.seedHash, String(item.cursor.seedHash))
  return params
}

export type ReadingTrailContext = {
  sessionStartedAt: string
  seed: string
  seenBucket: number
  /** Opaque PostgreSQL `numeric` string — never parsed to a JS number. */
  rankKey: string
  seedHash: number
}

/**
 * Pure: parses the Dispatch detail page's own searchParams back into a
 * trail context — returns null (never throws) for anything absent,
 * malformed, from an old/unversioned URL, or from an unsupported
 * version, since a missing/broken/stale trail simply means no Continue
 * Reading block renders (the Dispatch itself still renders normally),
 * exactly like a bare direct/shared URL.
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
  const version = get(TRAIL_PARAM_KEYS.version)
  const seenBucket = Number(get(TRAIL_PARAM_KEYS.seenBucket))
  const rankKey = get(TRAIL_PARAM_KEYS.rankKey)
  const seedHash = Number(get(TRAIL_PARAM_KEYS.seedHash))

  if (!sessionStartedAt || !seed) return null
  if (version !== String(READING_TRAIL_VERSION)) return null
  if (!Number.isFinite(seenBucket) || !Number.isFinite(seedHash)) return null
  if (!rankKey || rankKey.trim().length === 0) return null

  return { sessionStartedAt, seed, seenBucket, rankKey, seedHash }
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
    cursor: {
      seenBucket: context.seenBucket,
      rankKey: context.rankKey,
      seedHash: context.seedHash,
      id: currentDispatchId,
    },
    limit: count,
  })
  return items
}

// ============================================================
// BOARD FEED — Board Feed Foundation / Board Personalization checkpoints
// ============================================================

/** Opaque-to-callers cursor for board_feed_page's keyset pagination —
 * the (seen_bucket, rank_key, seed_hash, id) tuple of the last row
 * already returned. `rankKey` is carried as an opaque STRING (a
 * PostgreSQL `numeric` value) — never parsed into a JS number anywhere,
 * since NUMERIC can exceed what JS's own number type represents exactly.
 * Carries no meaning outside another getBoardFeedPage call. */
export type BoardFeedCursor = {
  seenBucket: number
  rankKey: string
  seedHash: number
  id: string
}

/** One board_feed_page row, WITH the per-viewer ranking/cursor
 * information the RPC already computes and previously discarded after
 * mapping — Home Phase 1 needs `isKept`/`isFamiliar` to partition
 * sections (From Minds You Keep = isKept only, Serendipity =
 * isFamiliar === false only) and `cursor` (this row's OWN seen_bucket/
 * rank_key/seed_hash) to build a reading-trail link for it (see
 * readingTrailSearchParams below). `cursor.id` always equals this item's
 * own `id`. Board Personalization checkpoint — minimal relationship
 * exposure: `isKept`/`isFamiliar` exist ONLY for this Home-partitioning
 * purpose; nothing broader (a labeled "correspondent" concept, a
 * `familiarity` string, etc.) is ever exposed here. */
export type BoardFeedItem = DispatchListItem & {
  isKept: boolean
  isFamiliar: boolean
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
  is_kept: boolean
  is_familiar: boolean
  seen_bucket: number
  /** PostgreSQL `numeric`, deserialized by supabase-js as a string —
   * never coerced to a JS number (see BoardFeedCursor's own comment). */
  rank_key: string
  seed_hash: number
}

/**
 * One page of The Board's session-stable, cursor-paginated,
 * relationship-aware, author-diverse feed — see docs/sql/2026-09-26-
 * board-personalization-ranking.sql's own extensive comment on
 * board_feed_page for the full ranking reasoning (session-stable unseen/
 * seen partition, the nested Keep:Correspondent then Familiar:Discovery
 * weighted interleave, the bounded familiar-author augmentation, and why
 * this is real keyset pagination, never OFFSET). This function's own job
 * is thin: call the RPC, attach authors/topics via the same batched
 * helper every other Dispatch listing already uses, and turn the last
 * row's own (seen_bucket, rank_key, seed_hash, id) into the next page's
 * cursor.
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
    p_cursor_seen_bucket: params.cursor?.seenBucket ?? null,
    p_cursor_rank_key: params.cursor?.rankKey ?? null,
    p_cursor_seed_hash: params.cursor?.seedHash ?? null,
    p_cursor_id: params.cursor?.id ?? null,
  })

  const typedRows = (rows ?? []) as BoardFeedRow[]
  const listItems = await attachTopicsAndAuthors(supabase, typedRows)
  const rowById = new Map(typedRows.map((row) => [row.id, row]))
  // attachTopicsAndAuthors preserves row order/count 1:1, so this zip is
  // safe — kept as an id-keyed lookup regardless, rather than assuming
  // index alignment, so it can never silently misattach a cursor.
  const items: BoardFeedItem[] = listItems.map((item) => {
    const row = rowById.get(item.id)!
    return {
      ...item,
      isKept: row.is_kept,
      isFamiliar: row.is_familiar,
      cursor: { seenBucket: row.seen_bucket, rankKey: row.rank_key, seedHash: row.seed_hash, id: row.id },
    }
  })

  const last = typedRows[typedRows.length - 1]
  const nextCursor: BoardFeedCursor | null =
    typedRows.length === limit && last
      ? { seenBucket: last.seen_bucket, rankKey: last.rank_key, seedHash: last.seed_hash, id: last.id }
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

// ============================================================
// DISPATCH POSTCARDS (Checkpoint 2) — a published Dispatch may carry at
// most one TEMPA Postcard, reusing the exact same architecture Letters
// already established (public.postcard_catalog/postcard_versions,
// PostcardBaseContent, resolveLetterPostcardDisplay, LetterheadPostcard/
// PostcardObject/PostcardThumbnail — see docs/sql/2026-09-25-dispatch-
// postcards.sql for the sibling `dispatch_postcards` table this reads/
// writes). Selected once, at initial publication, inside publish_dispatch
// itself (which resolves the CURRENT immutable postcard_versions row at
// that moment, exactly like write_letter/reply_to_letter) — never
// mutable afterward: update_dispatch deliberately gains no Postcard
// parameter at all, so there is no ordinary code path that can change or
// remove an already-published Dispatch's Postcard.
// ============================================================

/** The frozen production identity a Dispatch's Postcard actually shipped
 * with — mirrors lib/letters.ts's own LetterPostcardVersion shape
 * exactly (this is deliberately a parallel type, not a shared import:
 * Dispatches and Letters are kept structurally independent features that
 * happen to reuse the same underlying Postcard tables/components, never
 * each other's Letter/Dispatch-specific glue). */
export type DispatchPostcardVersion = {
  title: string
  location: string
  collection: string
  postmarkText: string
  footerText: string
  frontImagePath: string
  motionSrc: string | null
  durationSeconds: number | null
  revealLineAlignment: string | null
}

export type DispatchPostcard = {
  revealLine: string
  backMessage: string
  /** The publishing author's pseudonym exactly as it read at Publish —
   * frozen forever, same reasoning as letter_postcards.sender_pseudonym_
   * snapshot (see docs/sql/2026-09-14-letter-level-postcards.sql's own
   * doc comment for why this is snapshotted while the ordinary Dispatch
   * byline intentionally is not). */
  senderPseudonymSnapshot: string
  version: DispatchPostcardVersion
}

/** Converts a Dispatch's own frozen version into the generic base
 * content shape lib/moments.ts's resolveLetterPostcardDisplay merges
 * sender overrides onto — the exact same conversion lib/letters.ts's
 * letterPostcardToBaseContent performs for a delivered letter's
 * Postcard, reproduced here (not imported) to keep Dispatches and
 * Letters structurally independent. */
export function dispatchPostcardToBaseContent(version: DispatchPostcardVersion): PostcardBaseContent {
  return {
    title: version.title,
    location: version.location,
    collection: version.collection,
    frontImagePath: version.frontImagePath,
    postmarkText: version.postmarkText,
    footerText: version.footerText,
    living: version.motionSrc
      ? {
          motionSrc: version.motionSrc,
          durationSeconds: version.durationSeconds ?? undefined,
          revealLineAlignment: (version.revealLineAlignment as PostcardRevealLineAlignment | null) ?? undefined,
        }
      : undefined,
  }
}

type DispatchPostcardRow = {
  reveal_line: string | null
  back_message: string
  sender_pseudonym_snapshot: string
  postcard_versions: {
    title: string
    location: string
    collection: string
    postmark_text: string
    footer_text: string
    front_image_path: string
    motion_src: string | null
    duration_seconds: number | null
    reveal_line_alignment: string | null
  } | null
}

/**
 * The one Postcard attached to this Dispatch, if any — a plain SELECT
 * against dispatch_postcards (RLS-scoped to "the underlying Dispatch is
 * visible to this authenticated reader," see the migration's own
 * dispatch_postcards_select_visible policy), joined to its frozen
 * postcard_versions row through the embedded relation. Used by the
 * authenticated reader (app/board/[dispatchId]/page.tsx) and by the
 * edit-mode composer's own read-only display; the signed-out external
 * reader instead gets its Postcard bundled straight into
 * get_shared_dispatch's own response (see getSharedDispatch below) —
 * never this function, which depends on an authenticated Supabase
 * client.
 */
export async function getDispatchPostcard(
  supabase: SupabaseClient,
  dispatchId: string
): Promise<DispatchPostcard | null> {
  const { data } = await supabase
    .from('dispatch_postcards')
    .select(
      'reveal_line, back_message, sender_pseudonym_snapshot, postcard_versions(title, location, collection, postmark_text, footer_text, front_image_path, motion_src, duration_seconds, reveal_line_alignment)'
    )
    .eq('dispatch_id', dispatchId)
    .maybeSingle()

  const row = data as unknown as DispatchPostcardRow | null
  if (!row || !row.postcard_versions) return null

  return {
    revealLine: row.reveal_line ?? '',
    backMessage: row.back_message,
    senderPseudonymSnapshot: row.sender_pseudonym_snapshot,
    version: {
      title: row.postcard_versions.title,
      location: row.postcard_versions.location,
      collection: row.postcard_versions.collection,
      postmarkText: row.postcard_versions.postmark_text,
      footerText: row.postcard_versions.footer_text,
      frontImagePath: row.postcard_versions.front_image_path,
      motionSrc: row.postcard_versions.motion_src,
      durationSeconds: row.postcard_versions.duration_seconds,
      revealLineAlignment: row.postcard_versions.reveal_line_alignment,
    },
  }
}

export type PublishDispatchError = { message: string; code?: string; details?: string; hint?: string } | null

export type DispatchMomentDraft = { position: number; imagePath: string }

/**
 * Publishes a Dispatch (title, body, up to 3 topics, still-image
 * Moments, an optional Postcard) via the publish_dispatch RPC — one
 * atomic transaction, same reasoning as publish_question_answer: a
 * Dispatch must never be left with only some of its topics/Moments/
 * Postcard inserted if validation fails partway through. `postcard` is
 * the SAME draft shape the Letter composer already uses
 * (LetterPostcardDraft — reused as-is, not a parallel type) — the
 * server-side RPC resolves it to a frozen postcard_version_id at
 * publish time, exactly like write_letter does for a sent letter;
 * omitted/null means no Postcard, valid behavior either way.
 */
export async function publishDispatch(
  supabase: SupabaseClient,
  input: {
    title: string
    body: string
    topics: string[]
    moments?: DispatchMomentDraft[]
    postcard?: LetterPostcardDraft | null
  }
): Promise<{ data: Dispatch | null; error: PublishDispatchError }> {
  const { data, error } = await supabase.rpc('publish_dispatch', {
    p_title: input.title,
    p_body: input.body,
    p_topics: normalizeTopics(input.topics),
    p_moments: (input.moments ?? []).map((m) => ({ position: m.position, type: 'photo', image_path: m.imagePath })),
    // Same explicit-null-over-empty-string convention toMomentRpcPayload
    // already established at this RPC boundary (lib/moments.ts).
    p_postcard: input.postcard
      ? {
          postcard_key: input.postcard.postcardKey,
          reveal_line: input.postcard.revealLine.trim().length > 0 ? input.postcard.revealLine : null,
          back_message: input.postcard.backMessage.trim().length > 0 ? input.postcard.backMessage : null,
        }
      : null,
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

// Smoke-test contract completion checkpoint — Published Dispatch
// editing contract, Sections E/F/G. Mirrors update_dispatch's own two
// new eligibility checks exactly (docs/sql/2026-09-28-title-postcard-
// and-edit-window.sql): now() <= published_at + 30 minutes, AND no
// dispatch_replies row exists for this Dispatch (checked as bare row
// EXISTENCE — never filtered by moderation_status/deleted_at — since
// neither a member's own tombstone (delete_reply) nor a moderator hide
// (admin_hide_reply) ever removes the row itself; see
// docs/sql/2026-09-23-dispatch-replies.sql. "Once somebody has joined
// the public conversation, the published original becomes part of that
// conversation record," permanently, is therefore a real, durable
// guarantee the schema already supports — not something this checkpoint
// had to invent.
export const DISPATCH_EDIT_WINDOW_MINUTES = 30

/**
 * Pure: whether `now` still falls within the post-publish edit window.
 * The authoritative timestamp is ALWAYS publishedAt — never
 * updated_at (dispatches has no such column at all) and never a
 * client clock snapshot frozen at page load; callers pass a fresh
 * `now` (defaulting to `new Date()`) each time this is evaluated. This
 * is a UI HINT only, exactly like canEditDispatch below — the real,
 * authoritative check runs inside update_dispatch itself, freshly, on
 * every save, which is what actually closes the race a stale client
 * read could otherwise open.
 */
export function isWithinDispatchEditWindow(publishedAt: string, now: Date = new Date()): boolean {
  return now.getTime() <= new Date(publishedAt).getTime() + DISPATCH_EDIT_WINDOW_MINUTES * 60 * 1000
}

/**
 * Pure: whether the ordinary Edit affordance should be OFFERED at all —
 * "the product should not tease an unavailable action." This is a UI
 * hint, never the authority: `replyExists` is typically derived from an
 * RLS-governed read (getDispatchReplies), which can undercount a Reply
 * that is currently moderator-hidden and authored by someone other than
 * the Dispatch's own author (dispatch_replies_select_published's
 * own-author exception is scoped to the REPLY's author, not the
 * Dispatch's) — a disclosed, accepted imprecision for a hint only,
 * since update_dispatch re-checks unconditional row existence itself,
 * server-side, regardless of what this function ever returned.
 */
export function canEditDispatch(state: {
  isAuthor: boolean
  withinEditWindow: boolean
  replyExists: boolean
}): boolean {
  return state.isAuthor && state.withinEditWindow && !state.replyExists
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
  /** Checkpoint 2 — resolved straight out of get_shared_dispatch's own
   * widened response (never a second query, never letter_postcards/
   * postcard_catalog/postcard_versions touched directly by an anon
   * client) — null when this Dispatch carries no Postcard. */
  postcard: DispatchPostcard | null
}

type SharedDispatchPostcardJson = {
  title: string
  location: string
  collection: string
  postmark_text: string
  footer_text: string
  front_image_path: string
  motion_src: string | null
  duration_seconds: number | null
  reveal_line_alignment: string | null
  reveal_line: string | null
  back_message: string
  sender_pseudonym_snapshot: string
} | null

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
  /** Checkpoint 2 — the resolved Postcard fields required for
   * presentation ONLY, built server-side inside the SECURITY DEFINER
   * function itself; null when this Dispatch has no attached Postcard.
   * Optional here for the same reason author_country is: an older RPC
   * row (before this migration) simply won't carry the key. */
  postcard?: SharedDispatchPostcardJson
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

  const postcardJson = row.postcard ?? null
  const postcard: DispatchPostcard | null = postcardJson
    ? {
        revealLine: postcardJson.reveal_line ?? '',
        backMessage: postcardJson.back_message,
        senderPseudonymSnapshot: postcardJson.sender_pseudonym_snapshot,
        version: {
          title: postcardJson.title,
          location: postcardJson.location,
          collection: postcardJson.collection,
          postmarkText: postcardJson.postmark_text,
          footerText: postcardJson.footer_text,
          frontImagePath: postcardJson.front_image_path,
          motionSrc: postcardJson.motion_src,
          durationSeconds: postcardJson.duration_seconds,
          revealLineAlignment: postcardJson.reveal_line_alignment,
        },
      }
    : null

  return {
    id: row.dispatch_id,
    title: row.title,
    body: row.body,
    publishedAt: row.published_at,
    authorPseudonym: row.author_pseudonym,
    authorCountry: row.author_country ?? null,
    topics: row.topics,
    moments: mappedMoments,
    postcard,
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
