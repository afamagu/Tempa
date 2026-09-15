import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Board Experience Phase 2B — Replies. "Let someone respond thoughtfully
 * to a piece of writing," never a comments/threads/reactions system —
 * see docs/sql/2026-09-23-dispatch-replies.sql for the full schema/RPC
 * reasoning this module is a thin client wrapper around. No likes,
 * hearts, reactions, votes, or public score exist anywhere in this
 * module or the schema beneath it, and none should ever be added here.
 */

export const REPLY_MAX_CHARS = 500

export type Reply = {
  id: string
  dispatchId: string
  authorId: string
  authorPseudonym: string
  authorCountry: string | null
  body: string
  parentReplyId: string | null
  /** Null for a top-level Reply. For a Reply-to-Reply, the top-level
   * Reply this one is visually grouped under — never the true immediate
   * parent (see parentReplyId for that). This is what "one visual
   * indentation level, no Reddit staircase" is built on: every Reply
   * with a non-null rootReplyId renders as a flat, equally-indented
   * child of that one thread, regardless of how many real hops
   * parentReplyId itself represents. */
  rootReplyId: string | null
  /** Null for a top-level Reply. For a Reply-to-Reply, the author_id of
   * the TRUE immediate parent — derived server-side by create_reply,
   * never trusted from the client. Survives independently of whatever
   * later happens to the parent Reply's own content (moderation,
   * member deletion), which is exactly why this field exists as its own
   * column rather than being read off the (possibly since-tombstoned)
   * parent row at display time. */
  replyToUserId: string | null
  /** The reply-to target's current public pseudonym, resolved the same
   * privacy-respecting way every other cross-user pseudonym lookup in
   * this codebase already works (a join through public_profiles, which
   * is itself block-aware). Null whenever replyToUserId is set but that
   * identity cannot legitimately be resolved right now (e.g. a full
   * block exists between the viewer and that member) — callers should
   * render this case by quietly omitting the @Pseudonym line, never by
   * guessing or falling back to a raw id. */
  replyToPseudonym: string | null
  /** True once this Reply's own author has removed it (delete_reply).
   * The row and its identity/threading fields all remain fully present
   * — only `body` has been cleared server-side. Callers must render the
   * quiet "Reply removed" tombstone state whenever this is true, never
   * the (now-empty) body. */
  isDeleted: boolean
  createdAt: string
}

type ReplyRow = {
  id: string
  dispatch_id: string
  author_id: string
  body: string
  parent_reply_id: string | null
  root_reply_id: string | null
  reply_to_user_id: string | null
  deleted_at: string | null
  created_at: string
}

const REPLY_COLUMNS =
  'id, dispatch_id, author_id, body, parent_reply_id, root_reply_id, reply_to_user_id, deleted_at, created_at'

/**
 * Pure: orders a flat set of Replies for display — top-level threads
 * ordered oldest-first, and every Reply within a thread (regardless of
 * its real parentReplyId depth) ordered chronologically beneath its own
 * thread. This is the entire mechanism behind "one visual indentation
 * level": the caller renders anything with a non-null rootReplyId as an
 * indented child of that thread, never staircasing deeper based on the
 * true parent chain.
 *
 * Deliberately done here in JS, not as a single SQL ORDER BY, because
 * grouping "top-level threads oldest-first" by the THREAD's own
 * created_at cannot be expressed as `ORDER BY COALESCE(root_reply_id,
 * id)` — root_reply_id is a random UUID, not a time-ordered value, so
 * sorting by it directly would NOT be chronological. Doing this in the
 * application layer over one already-fetched, small, flat result set
 * (see getDispatchReplies) is the simplest correct approach — matching
 * the checkpoint's own "no sophisticated pagination/ranking, normally
 * chronological" instruction — rather than a more complex recursive or
 * window-function SQL query for what will typically be a modest number
 * of rows.
 *
 * Re-verified, unchanged, in the Phase 2B pre-SQL correction pass: this
 * function groups by each ROOT Reply's own createdAt (via rootCreatedAt
 * below), never by root_reply_id/id itself — see lib/replies.test.ts's
 * dedicated tests using deliberately non-chronological UUID-shaped ids
 * for the standing regression proof.
 */
export function orderRepliesForDisplay(replies: Reply[]): Reply[] {
  const rootCreatedAt = new Map<string, string>()
  for (const r of replies) {
    if (r.parentReplyId === null) rootCreatedAt.set(r.id, r.createdAt)
  }
  const rootKey = (r: Reply) => r.rootReplyId ?? r.id

  return [...replies].sort((a, b) => {
    const ra = rootCreatedAt.get(rootKey(a)) ?? a.createdAt
    const rb = rootCreatedAt.get(rootKey(b)) ?? b.createdAt
    if (ra !== rb) return ra.localeCompare(rb)
    if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt)
    return a.id.localeCompare(b.id)
  })
}

/**
 * Pure: structural audit, final security review — a moderator-hidden
 * root Reply is excluded from RLS's own SELECT result entirely for any
 * viewer other than its own author (unlike a member-tombstoned Reply,
 * which stays selectable with body='' and renders its own "Reply
 * removed" row). That leaves any of its still-visible descendants
 * (rootReplyId pointing at that now-absent id) structurally "orphaned":
 * present in the fetched set, but with no corresponding root row to
 * nest under.
 *
 * Chosen behavior (smallest safe option, no new SECURITY DEFINER read
 * path): suppress the entire orphaned thread rather than render its
 * descendants floating with no visible anchor, an invented placeholder,
 * or a display-order fallback that could reshuffle them relative to
 * other threads. This never crashes, never exposes the hidden root's
 * body or any signal about WHY it is unavailable (moderator-hidden vs.
 * simply nonexistent are indistinguishable from here, deliberately), and
 * never mis-attaches a descendant to an unrelated thread.
 *
 * A member-tombstoned root is NOT affected by this function at all — it
 * stays present in `replies` (RLS never filters on deleted_at), so its
 * descendants keep their real anchor and nest normally beneath its own
 * "Reply removed" row.
 */
export function filterOrphanedThreads(replies: Reply[]): Reply[] {
  const presentIds = new Set(replies.map((r) => r.id))
  return replies.filter((r) => r.rootReplyId === null || presentIds.has(r.rootReplyId))
}

/**
 * Every Reply on one Dispatch, ready for display order. A single flat
 * query (RLS — dispatch_replies_select_published — is the actual
 * visibility boundary, inheriting the parent Dispatch's own current
 * visibility automatically, exactly like dispatch_moments/dispatch_
 * topics already do), then one batched author/reply-to pseudonym
 * resolution (never one query per Reply), then filterOrphanedThreads
 * and the pure ordering above.
 */
export async function getDispatchReplies(supabase: SupabaseClient, dispatchId: string): Promise<Reply[]> {
  const { data: rows } = await supabase
    .from('dispatch_replies')
    .select(REPLY_COLUMNS)
    .eq('dispatch_id', dispatchId)
    .order('created_at', { ascending: true })

  const typedRows = (rows ?? []) as ReplyRow[]
  if (typedRows.length === 0) return []

  const authorIds = [...new Set(typedRows.map((r) => r.author_id))]
  const replyToIds = [...new Set(typedRows.map((r) => r.reply_to_user_id).filter((id): id is string => id !== null))]
  const allProfileIds = [...new Set([...authorIds, ...replyToIds])]

  const { data: profiles } = await supabase
    .from('public_profiles')
    .select('id, pseudonym, country')
    .in('id', allProfileIds)

  const profileById = new Map(
    (profiles ?? []).map((p) => [p.id, p as { id: string; pseudonym: string; country: string | null }])
  )

  const replies = typedRows.map(
    (row): Reply => ({
      id: row.id,
      dispatchId: row.dispatch_id,
      authorId: row.author_id,
      authorPseudonym: profileById.get(row.author_id)?.pseudonym ?? 'A member',
      authorCountry: profileById.get(row.author_id)?.country ?? null,
      body: row.body,
      parentReplyId: row.parent_reply_id,
      rootReplyId: row.root_reply_id,
      replyToUserId: row.reply_to_user_id,
      replyToPseudonym: row.reply_to_user_id ? (profileById.get(row.reply_to_user_id)?.pseudonym ?? null) : null,
      isDeleted: row.deleted_at !== null,
      createdAt: row.created_at,
    })
  )

  return orderRepliesForDisplay(filterOrphanedThreads(replies))
}

/**
 * Pure: the composer's own validation, mirroring create_reply's
 * server-side checks exactly (blank, then length) so the client can
 * give immediate feedback without a round trip — the server remains the
 * actual authority regardless.
 */
export function replyBodyError(body: string): string | null {
  const trimmed = body.trim()
  if (trimmed.length === 0) return 'A Reply needs some writing.'
  if (trimmed.length > REPLY_MAX_CHARS) return 'Reply is too long.'
  return null
}

export type CreateReplyError = { message: string; code?: string } | null

/**
 * Creates a Reply via create_reply — the sole write path. The RPC
 * derives the author from auth.uid() and, for a Reply-to-Reply, derives
 * reply_to_user_id and root_reply_id itself from the parent row; this
 * function never sends any of those three as client input. Callers
 * follow the same established pattern as KeepButton/Board's other
 * mutations: on success, re-fetch (router.refresh() from a Server
 * Component parent) rather than splicing an un-enriched row (no
 * pseudonym yet) into local state.
 */
export async function createReply(
  supabase: SupabaseClient,
  input: { dispatchId: string; body: string; parentReplyId?: string | null }
): Promise<{ error: CreateReplyError }> {
  const { error } = await supabase.rpc('create_reply', {
    p_dispatch_id: input.dispatchId,
    p_body: input.body,
    p_parent_reply_id: input.parentReplyId ?? null,
  })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

export type DeleteReplyError = { message: string; code?: string } | null

/**
 * A member's own tombstone/soft-removal of their own Reply
 * (delete_reply) — author-only, server-enforced. Never a hard delete:
 * the row, its id, and its threading fields (parentReplyId/
 * rootReplyId/replyToUserId/createdAt) all survive so any existing
 * descendant keeps resolving correctly; only the body is cleared.
 */
export async function deleteReply(supabase: SupabaseClient, replyId: string): Promise<{ error: DeleteReplyError }> {
  const { error } = await supabase.rpc('delete_reply', { p_reply_id: replyId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}
