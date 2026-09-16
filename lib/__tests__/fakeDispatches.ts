// A minimal Supabase-client stand-in for exactly the query shapes
// lib/dispatches.ts issues against dispatches, dispatch_topics,
// public_profiles, kept_minds, and dispatch_views.
//
// Mirrors the LIVE RLS policies' own visibility predicates structurally
// — dispatches_select_published: status = 'published' OR author_id =
// auth.uid() (see docs/sql/2026-09-07-dispatches-and-board.sql) —
// applied here exactly the same way createFakeLettersForParticipant
// mirrors letters_for_participant's own predicate: every row is
// filtered by this rule BEFORE any of dispatches.ts's own .eq() filters
// run, so a test can prove an unpublished/other-author row is invisible
// regardless of what the query itself asks for. kept_minds and
// dispatch_views rows are scoped to viewerId only, matching their own
// "_own" RLS policies (a row belonging to a different viewer is simply
// never in this viewer's visible set).

export type FakeDispatchRow = {
  id: string
  author_id: string
  title: string
  body: string
  status: 'published' | 'unpublished'
  published_at: string
  // Admin Phase 2A-1 — defaults to 'visible' (matching the migration's
  // `not null default 'visible'`) when a test row omits it.
  moderation_status?: 'visible' | 'hidden'
}

export type FakeProfileRow = {
  id: string
  pseudonym: string
  country?: string | null
  pinned_dispatch_id?: string | null
}
export type FakeTopicRow = { dispatch_id: string; topic: string }
export type FakeKeptRow = {
  viewer_user_id: string
  kept_user_id: string
  /** Board Feed Foundation checkpoint (Phase 2A), session-stability
   * correction — board_feed_page pins the Keep-ADD direction to session
   * start via this existing column (kept_minds.created_at < p_session_
   * started_at), see docs/sql/2026-09-22-board-feed-foundation.sql.
   * Optional: defaults to a safely-in-the-past sentinel, so existing
   * fixtures that don't care about Keep timing continue to test as
   * "kept before session start," matching their pre-correction
   * behavior. */
  created_at?: string
}
export type FakeViewRow = {
  viewer_id: string
  dispatch_id: string
  last_paragraph_index: number
  /** The table's own MUTABLE latest-view timestamp — upserted to now()
   * on every real recordDispatchProgress call. Optional here because
   * most existing fixtures only care about "a view row exists at all"
   * (hasSeenDispatch/getSeenDispatchIds); defaults to a fixed,
   * safely-in-the-past sentinel so those keep passing unchanged. */
  viewed_at?: string
  /** Session-stability correction (Board Feed Foundation checkpoint,
   * Phase 2A) — the IMMUTABLE "earliest known view" fact board_feed_page
   * actually keys its tiering on (see docs/sql/2026-09-22-board-feed-
   * foundation.sql). Optional: when omitted, defaults to viewed_at (the
   * same backfill relationship the real migration establishes for
   * pre-existing rows — first_viewed_at = viewed_at for any fixture that
   * doesn't care about the two diverging), and if viewed_at is ALSO
   * omitted, to the same safely-in-the-past sentinel viewed_at itself
   * defaults to. */
  first_viewed_at?: string
}
/** Board Personalization checkpoint — mirrors public.correspondences
 * (docs/sql/2026-08-31-correspondences.sql, established_at added by
 * docs/sql/2026-09-03-correspondence-established-at.sql) closely enough
 * to exercise board_feed_page's second familiarity signal: `status`
 * must be 'active' AND `established_at` must be non-null AND session-
 * stable (< session start) to count — a first-contact correspondence
 * that never received a reply (established_at still null) never
 * qualifies. `participant_low`/`participant_high` mirror the real
 * table's canonical ordered-pair storage; which one is "low" vs "high"
 * never matters to this fake's own lookups (both are always checked). */
export type FakeCorrespondenceRow = {
  participant_low: string
  participant_high: string
  status: 'active' | 'closed'
  established_at?: string | null
}

export type FakeShareRow = { id: string; dispatch_id: string; revoked_at: string | null }
export type FakeMomentRow = { id: string; dispatch_id: string; position: number; image_path: string }
/** Safety & Trust Checkpoint 1B/1C: mirrors blocked_users' shape —
 * directional, (blocker_id, blocked_id), now carrying a scope
 * ('letters' | 'full') per Checkpoint 1C's two-levels-of-blocking
 * design. Defaults to 'full' where a test constructs a row directly,
 * matching the migration's own column default for pre-existing rows. */
export type FakeBlockRow = {
  blocker_id: string
  blocked_id: string
  scope?: 'letters' | 'full'
  created_at?: string
}

/** Board Feed Foundation checkpoint (Phase 2A) — mirrors
 * account_enforcement_state.status, keyed by user id. A member absent
 * from this map defaults to 'active', matching current_account_status's
 * own coalesce. */
export type FakeAccountStatus = 'active' | 'restricted' | 'suspended' | 'banned'

/** Board Experience Phase 2B — mirrors dispatch_replies (docs/sql/2026-
 * 09-23-dispatch-replies.sql). moderation_status/deleted_at default to
 * 'visible'/null for a fixture that doesn't care about either. */
export type FakeReplyRow = {
  id: string
  dispatch_id: string
  author_id: string
  body: string
  parent_reply_id?: string | null
  root_reply_id?: string | null
  reply_to_user_id?: string | null
  moderation_status?: 'visible' | 'hidden'
  deleted_at?: string | null
  created_at: string
}

/** Board Experience Phase 2C — mirrors dispatch_worth_reading (docs/sql/
 * 2026-09-24-dispatch-worth-reading.sql). created_at defaults to a
 * fixed sentinel for a fixture that doesn't care about its value. */
export type FakeWorthReadingRow = { dispatch_id: string; user_id: string; created_at?: string }

/** Dispatch Postcards Checkpoint 2 — mirrors the LIVE Postcard catalogue
 * tables (public.postcard_catalog/public.postcard_versions, unchanged by
 * this checkpoint) closely enough to exercise publish_dispatch's own
 * Postcard validation/resolution in pure JS. */
export type FakePostcardCatalogRow = { key: string; is_active: boolean }
export type FakePostcardVersionRow = {
  id: string
  postcard_key: string
  is_current: boolean
  title: string
  location: string
  collection: string
  postmark_text: string
  footer_text: string
  front_image_path: string
  motion_src?: string | null
  duration_seconds?: number | null
  reveal_line_alignment?: string | null
}
/** Mirrors public.dispatch_postcards (docs/sql/2026-09-25-dispatch-
 * postcards.sql) — at most one row per dispatch_id, written only by the
 * publish_dispatch mock below, read by the dispatch_postcards table
 * handler (getDispatchPostcard's own query shape) and by get_shared_
 * dispatch's own mock. */
export type FakeDispatchPostcardRow = {
  dispatch_id: string
  postcard_version_id: string
  reveal_line: string | null
  back_message: string
  sender_pseudonym_snapshot: string
}

export function createFakeDispatches(options: {
  viewerId: string | null
  rows: FakeDispatchRow[]
  profiles?: FakeProfileRow[]
  topics?: FakeTopicRow[]
  kept?: FakeKeptRow[]
  views?: FakeViewRow[]
  correspondences?: FakeCorrespondenceRow[]
  shares?: FakeShareRow[]
  moments?: FakeMomentRow[]
  blocked?: FakeBlockRow[]
  accountStatus?: Record<string, FakeAccountStatus>
  replies?: FakeReplyRow[]
  worthReading?: FakeWorthReadingRow[]
  postcardCatalog?: FakePostcardCatalogRow[]
  postcardVersions?: FakePostcardVersionRow[]
  dispatchPostcards?: FakeDispatchPostcardRow[]
}) {
  const { viewerId } = options
  const rows = options.rows
  for (const r of rows) if (r.moderation_status === undefined) r.moderation_status = 'visible'
  const profiles = options.profiles ?? []
  const topics = options.topics ?? []
  const kept = options.kept ?? []
  const views = options.views ?? []
  const correspondences = options.correspondences ?? []
  const shares = options.shares ?? []
  const moments = options.moments ?? []
  const blocked = options.blocked ?? []
  const accountStatus = options.accountStatus ?? {}
  const replies = options.replies ?? []
  const worthReading = options.worthReading ?? []
  const postcardCatalog = options.postcardCatalog ?? []
  const postcardVersions = options.postcardVersions ?? []
  const dispatchPostcards = options.dispatchPostcards ?? []
  for (const r of replies) {
    if (r.moderation_status === undefined) r.moderation_status = 'visible'
    if (r.parent_reply_id === undefined) r.parent_reply_id = null
    if (r.root_reply_id === undefined) r.root_reply_id = null
    if (r.reply_to_user_id === undefined) r.reply_to_user_id = null
    if (r.deleted_at === undefined) r.deleted_at = null
  }

  // Mirrors tempa_private.author_content_publicly_visible (docs/sql/
  // 2026-09-22-board-feed-foundation.sql): only 'suspended'/'banned'
  // exclude an author's already-published content from OTHER members —
  // 'restricted' and 'active' (including a status-less author) stay
  // fully visible, matching the live function's own exact boundary.
  function authorContentPubliclyVisible(authorId: string) {
    const status = accountStatus[authorId] ?? 'active'
    return status !== 'suspended' && status !== 'banned'
  }

  // Mirrors tempa_private.is_blocked_pair(a, b) as redefined by
  // Checkpoint 1C (docs/sql/2026-09-12-scoped-blocking-and-fixes.sql):
  // FULL block only, either direction. A letters-only block must NOT
  // trip this — it gates public visibility (Dispatches, profiles,
  // Minds, Keep in Mind), which the two-levels-of-blocking design
  // explicitly leaves untouched by a letters-only block.
  function isBlockedPair(a: string | null, b: string) {
    if (!a) return false
    return blocked.some(
      (row) =>
        (row.scope ?? 'full') === 'full' &&
        ((row.blocker_id === a && row.blocked_id === b) || (row.blocker_id === b && row.blocked_id === a))
    )
  }

  // Note: the NEW tempa_private.is_correspondence_blocked_pair(a, b)
  // (ANY active block, letters or full, gating new correspondence RPCs)
  // has no corresponding simulation here — send_first_letter/
  // reply_to_letter/write_letter/photo-sharing aren't modeled as fake
  // RPCs in this file at all (see lib/__tests__/simulateLetterRpcs.ts
  // and simulateCorrespondenceRpcs.ts, which are pure INSERT-shape/
  // validation-order simulations with no blocking awareness). The SQL
  // migration text itself (docs/sql/2026-09-12-scoped-blocking-and-
  // fixes.sql) is the authority for that helper's behavior.

  // Mirrors dispatches_select_published's RLS predicate (Admin Phase
  // 2A-1: status = 'published' AND moderation_status = 'visible' AND
  // not blocked) OR author_id = auth.uid() — a hidden Dispatch resolves
  // through this base filter ONLY for its own author, exactly like the
  // live policy. getDispatchById relies on this base filter alone (no
  // extra .eq of its own) for exactly that reason.
  function visibleRows() {
    return rows.filter(
      (r) =>
        (r.status === 'published' &&
          r.moderation_status === 'visible' &&
          !isBlockedPair(viewerId, r.author_id) &&
          authorContentPubliclyVisible(r.author_id)) ||
        r.author_id === viewerId
    )
  }

  function dispatchesFrom() {
    const filters: { authorId?: string; status?: string; id?: string; moderationStatus?: string } = {}
    let insertedPayload: Record<string, unknown> | null = null

    function applyFilters() {
      return visibleRows()
        .filter((r) => (filters.authorId ? r.author_id === filters.authorId : true))
        .filter((r) => (filters.status ? r.status === filters.status : true))
        .filter((r) => (filters.id ? r.id === filters.id : true))
        // Only applied when the caller actually asks for it (the
        // Board/Home/profile LISTING queries add this explicitly, per
        // lib/dispatches.ts) — getDispatchById never adds this filter,
        // deliberately, so an author's own hidden Dispatch still
        // resolves there.
        .filter((r) => (filters.moderationStatus ? r.moderation_status === filters.moderationStatus : true))
        .sort((a, b) => b.published_at.localeCompare(a.published_at))
    }

    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        if (column === 'author_id') filters.authorId = value as string
        if (column === 'status') filters.status = value as string
        if (column === 'id') filters.id = value as string
        if (column === 'moderation_status') filters.moderationStatus = value as string
        return builder
      },
      order() {
        return builder
      },
      async limit(n: number) {
        return { data: applyFilters().slice(0, n), error: null }
      },
      async maybeSingle() {
        return { data: applyFilters()[0] ?? null, error: null }
      },
      insert(payload: Record<string, unknown>) {
        insertedPayload = payload
        return builder
      },
      async single() {
        if (!insertedPayload) return { data: applyFilters()[0] ?? null, error: null }
        if (!viewerId) {
          return { data: null, error: { message: 'new row violates row-level security policy', code: '42501' } }
        }
        const row: FakeDispatchRow = {
          id: `dispatch-${rows.length + 1}`,
          author_id: viewerId,
          title: insertedPayload.title as string,
          body: insertedPayload.body as string,
          status: 'published',
          published_at: new Date().toISOString(),
          // Independent review item 5 (final audit round) — mirrors
          // the column default / dispatches_insert_own's tightened
          // WITH CHECK: a fresh insert always lands visible/unmoderated.
          moderation_status: 'visible',
        }
        rows.push(row)
        return { data: row, error: null }
      },
      then(resolve: (value: { data: FakeDispatchRow[]; error: null }) => void) {
        resolve({ data: applyFilters(), error: null })
      },
    }

    return builder
  }

  // Shared by both `public_profiles` (cross-user, batched `.in()` reads
  // for authors/pseudonyms) and `profiles` (a member reading their own
  // row directly, e.g. the pinned-Dispatch check — see
  // app/board/[dispatchId]/page.tsx) — the live schema keeps these as a
  // curated view over a base table, but for this fake's purposes a
  // single shared array is enough fidelity for both access patterns.
  function profilesFrom() {
    const filters: { ids?: string[]; id?: string } = {}
    const builder = {
      select() {
        return builder
      },
      in(_column: string, values: string[]) {
        filters.ids = values
        return builder
      },
      eq(column: string, value: unknown) {
        if (column === 'id') filters.id = value as string
        return builder
      },
      async maybeSingle() {
        const match = profiles.find((p) => p.id === filters.id) ?? null
        return { data: match, error: null }
      },
      then(resolve: (value: { data: FakeProfileRow[]; error: null }) => void) {
        resolve({ data: profiles.filter((p) => (filters.ids ? filters.ids.includes(p.id) : true)), error: null })
      },
    }
    return builder
  }

  function topicsFrom() {
    let dispatchIds: string[] = []
    const builder = {
      select() {
        return builder
      },
      in(_column: string, values: string[]) {
        dispatchIds = values
        return builder
      },
      then(resolve: (value: { data: FakeTopicRow[]; error: null }) => void) {
        resolve({ data: topics.filter((t) => dispatchIds.includes(t.dispatch_id)), error: null })
      },
    }
    return builder
  }

  function keptMindsFrom() {
    const filters: { viewerUserId?: string; keptUserId?: string } = {}
    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        if (column === 'viewer_user_id') filters.viewerUserId = value as string
        if (column === 'kept_user_id') filters.keptUserId = value as string
        return builder
      },
      async maybeSingle() {
        const match =
          kept.find(
            (k) =>
              (!filters.viewerUserId || k.viewer_user_id === filters.viewerUserId) &&
              (!filters.keptUserId || k.kept_user_id === filters.keptUserId)
          ) ?? null
        return { data: match, error: null }
      },
      then(resolve: (value: { data: FakeKeptRow[]; error: null }) => void) {
        resolve({
          data: kept.filter((k) => (!filters.viewerUserId ? true : k.viewer_user_id === filters.viewerUserId)),
          error: null,
        })
      },
    }
    return builder
  }

  function viewsFrom() {
    const filters: { viewerId?: string; dispatchId?: string } = {}
    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        if (column === 'viewer_id') filters.viewerId = value as string
        if (column === 'dispatch_id') filters.dispatchId = value as string
        return builder
      },
      async maybeSingle() {
        const match =
          views.find(
            (v) =>
              (!filters.viewerId || v.viewer_id === filters.viewerId) &&
              (!filters.dispatchId || v.dispatch_id === filters.dispatchId)
          ) ?? null
        return { data: match, error: null }
      },
      then(resolve: (value: { data: FakeViewRow[]; error: null }) => void) {
        resolve({
          data: views.filter((v) => (!filters.viewerId ? true : v.viewer_id === filters.viewerId)),
          error: null,
        })
      },
    }
    return builder
  }

  function sharesFrom() {
    const filters: { dispatchId?: string; revokedIsNull?: boolean } = {}
    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        if (column === 'dispatch_id') filters.dispatchId = value as string
        return builder
      },
      is(column: string, value: null) {
        if (column === 'revoked_at' && value === null) filters.revokedIsNull = true
        return builder
      },
      async maybeSingle() {
        const match =
          shares.find(
            (s) =>
              (!filters.dispatchId || s.dispatch_id === filters.dispatchId) &&
              (!filters.revokedIsNull || s.revoked_at === null)
          ) ?? null
        return { data: match, error: null }
      },
    }
    return builder
  }

  // Mirrors blocked_users_select_own: scoped to rows where the caller
  // is blocker_id — a row naming the caller as blocked_id (someone
  // else's block of them) is never returned, by construction, matching
  // the live RLS policy's own restriction. Supports the two query
  // shapes lib/blocking.ts actually issues: a plain ordered list
  // (getBlockedUsers) and a single-row lookup filtered by blocked_id
  // (getBlockScope).
  function blockedUsersFrom() {
    const filters: { blockedId?: string } = {}
    const ownRows = () => blocked.filter((b) => b.blocker_id === viewerId)
    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        if (column === 'blocked_id') filters.blockedId = value as string
        return builder
      },
      order() {
        return builder
      },
      async maybeSingle() {
        const match = ownRows().find((b) => b.blocked_id === filters.blockedId) ?? null
        return { data: match ? { scope: match.scope ?? 'full' } : null, error: null }
      },
      then(resolve: (value: { data: FakeBlockRow[]; error: null }) => void) {
        resolve({
          data: ownRows().map((b) => ({ ...b, scope: b.scope ?? 'full' })),
          error: null,
        })
      },
    }
    return builder
  }

  // dispatch_moments — supports both call shapes lib/dispatches.ts
  // actually issues: a single-dispatch read ordered by position
  // (getDispatchMoments/getDispatchMomentsForEditing, via .eq) and a
  // batched multi-dispatch read (getFirstMomentThumbnails, via .in) —
  // both always ordered oldest-position-first, matching the live
  // `order by position asc` every one of those functions uses.
  function momentsFrom() {
    const filters: { dispatchId?: string; dispatchIds?: string[] } = {}
    const applyFilters = () =>
      moments
        .filter((m) => (filters.dispatchId ? m.dispatch_id === filters.dispatchId : true))
        .filter((m) => (filters.dispatchIds ? filters.dispatchIds.includes(m.dispatch_id) : true))
        .sort((a, b) => a.position - b.position)
    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        if (column === 'dispatch_id') filters.dispatchId = value as string
        return builder
      },
      in(column: string, values: string[]) {
        if (column === 'dispatch_id') filters.dispatchIds = values
        return builder
      },
      order() {
        return builder
      },
      then(resolve: (value: { data: FakeMomentRow[]; error: null }) => void) {
        resolve({ data: applyFilters(), error: null })
      },
    }
    return builder
  }

  // Board Experience Phase 2B — mirrors dispatch_replies_select_
  // published (docs/sql/2026-09-23-dispatch-replies.sql). Final security
  // review correction: the parent Dispatch must be CURRENTLY, genuinely
  // public — published, moderator-visible, not full-blocked between the
  // viewer and the Dispatch's author, and that author's content publicly
  // visible — with NO own-author bypass on this parent gate (unlike
  // dispatches' own RLS, which does let an author see their own draft/
  // hidden Dispatch; that exception does NOT extend to Replies attached
  // to it). On top of that, the Reply's own moderation_status/blocking/
  // account-visibility, OR the Reply's own author viewing their own
  // Reply regardless of any of that. Deliberately no deleted_at filter —
  // a member-deleted Reply stays selectable (its row survives), matching
  // the real policy exactly.
  function replyParentReachable(dispatchId: string) {
    const d = rows.find((r) => r.id === dispatchId)
    if (!d) return false
    return (
      d.status === 'published' &&
      d.moderation_status === 'visible' &&
      !isBlockedPair(viewerId, d.author_id) &&
      authorContentPubliclyVisible(d.author_id)
    )
  }

  function visibleReplies() {
    return replies.filter(
      (r) =>
        replyParentReachable(r.dispatch_id) &&
        ((r.moderation_status === 'visible' &&
          !isBlockedPair(viewerId, r.author_id) &&
          authorContentPubliclyVisible(r.author_id)) ||
          r.author_id === viewerId)
    )
  }

  function repliesFrom() {
    const filters: { dispatchId?: string } = {}
    const applyFilters = () =>
      visibleReplies()
        .filter((r) => (filters.dispatchId ? r.dispatch_id === filters.dispatchId : true))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        if (column === 'dispatch_id') filters.dispatchId = value as string
        return builder
      },
      order() {
        return builder
      },
      then(resolve: (value: { data: FakeReplyRow[]; error: null }) => void) {
        resolve({ data: applyFilters(), error: null })
      },
    }
    return builder
  }

  // Board Experience Phase 2C — mirrors dispatch_worth_reading_own's RLS
  // predicate (auth.uid() = user_id): scoped to viewerId only, matching
  // the live policy's own restriction — a row belonging to a different
  // user is simply never in this viewer's visible set, regardless of
  // which dispatch_id/user_id filters the query itself adds. This is
  // the fake's only read path for this table; isDispatchWorthReading is
  // the sole caller.
  function worthReadingFrom() {
    const filters: { dispatchId?: string; userId?: string } = {}
    const ownRows = () => worthReading.filter((w) => w.user_id === viewerId)
    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        if (column === 'dispatch_id') filters.dispatchId = value as string
        if (column === 'user_id') filters.userId = value as string
        return builder
      },
      async maybeSingle() {
        const match =
          ownRows().find(
            (w) =>
              (!filters.dispatchId || w.dispatch_id === filters.dispatchId) &&
              (!filters.userId || w.user_id === filters.userId)
          ) ?? null
        return { data: match, error: null }
      },
    }
    return builder
  }

  // dispatch_postcards — mirrors getDispatchPostcard's own query shape:
  // a single row (via .maybeSingle()) joined to its embedded, frozen
  // postcard_versions relation, scoped to one dispatch_id. RLS itself
  // (dispatch_postcards_select_visible) is mirrored by simply reusing
  // visibleRows() — the same "is this Dispatch visible to this viewer"
  // predicate every other Dispatch-scoped table in this fake already
  // delegates through.
  function dispatchPostcardsFrom() {
    const filters: { dispatchId?: string } = {}
    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        if (column === 'dispatch_id') filters.dispatchId = value as string
        return builder
      },
      async maybeSingle() {
        const dispatchVisible = visibleRows().some((r) => r.id === filters.dispatchId)
        if (!dispatchVisible) return { data: null, error: null }
        const row = dispatchPostcards.find((p) => p.dispatch_id === filters.dispatchId)
        if (!row) return { data: null, error: null }
        const version = postcardVersions.find((v) => v.id === row.postcard_version_id) ?? null
        return {
          data: {
            reveal_line: row.reveal_line,
            back_message: row.back_message,
            sender_pseudonym_snapshot: row.sender_pseudonym_snapshot,
            postcard_versions: version
              ? {
                  title: version.title,
                  location: version.location,
                  collection: version.collection,
                  postmark_text: version.postmark_text,
                  footer_text: version.footer_text,
                  front_image_path: version.front_image_path,
                  motion_src: version.motion_src ?? null,
                  duration_seconds: version.duration_seconds ?? null,
                  reveal_line_alignment: version.reveal_line_alignment ?? null,
                }
              : null,
          },
          error: null,
        }
      },
    }
    return builder
  }

  function accountEnforcementFrom() {
    const filters: { userId?: string } = {}
    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        if (column === 'user_id') filters.userId = value as string
        return builder
      },
      async maybeSingle() {
        const status = filters.userId ? accountStatus[filters.userId] : undefined
        return { data: status ? { status } : null, error: null }
      },
    }
    return builder
  }

  function from(table: string) {
    if (table === 'dispatches') return dispatchesFrom()
    if (table === 'public_profiles' || table === 'profiles') return profilesFrom()
    if (table === 'dispatch_topics') return topicsFrom()
    if (table === 'kept_minds') return keptMindsFrom()
    if (table === 'dispatch_views') return viewsFrom()
    if (table === 'dispatch_shares') return sharesFrom()
    if (table === 'blocked_users') return blockedUsersFrom()
    if (table === 'dispatch_moments') return momentsFrom()
    if (table === 'account_enforcement_state') return accountEnforcementFrom()
    if (table === 'dispatch_replies') return repliesFrom()
    if (table === 'dispatch_worth_reading') return worthReadingFrom()
    if (table === 'dispatch_postcards') return dispatchPostcardsFrom()
    throw new Error(`fakeDispatches does not simulate table "${table}"`)
  }

  // A minimal stand-in for supabase.storage — just enough to exercise
  // getSharedDispatch's signed-URL resolution step deterministically,
  // without a real "dispatch-photos" bucket. Never returns the raw
  // path as-is; always a distinguishable "signed:" value, so a test can
  // assert a raw storage path never leaks through unresolved.
  const storage = {
    from(bucket: string) {
      return {
        async createSignedUrls(paths: string[]) {
          return {
            data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${bucket}/${path}` })),
            error: null,
          }
        },
      }
    },
  }

  // Mirrors publish_dispatch's own validation order (title blank/too
  // long, topic count) closely enough to exercise lib/dispatches.ts's
  // client-side call shape — the SQL migration's own RAISE EXCEPTION
  // paths are the actual authority, not this stand-in.
  async function rpc(fn: string, params?: Record<string, unknown>) {
    if (fn === 'publish_dispatch') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const title = (params?.p_title as string) ?? ''
      if (title.trim().length === 0) {
        return { data: null, error: { message: 'A Dispatch needs a title.', code: 'P0001' } }
      }
      if (title.length > 70) {
        return { data: null, error: { message: 'Title is too long.', code: 'P0001' } }
      }
      const topics = (params?.p_topics as string[]) ?? []
      if (topics.length > 3) {
        return { data: null, error: { message: 'A Dispatch may carry at most 3 topics.', code: 'P0001' } }
      }

      // Dispatch Postcards Checkpoint 2 — validated BEFORE any row is
      // pushed, mirroring publish_dispatch's own "validate first, so a
      // failure never leaves a half-published Dispatch behind" ordering.
      const postcardInput = params?.p_postcard as
        | { postcard_key: string | null; reveal_line: string | null; back_message: string | null }
        | null
        | undefined
      let resolvedPostcard: {
        postcard_version_id: string
        reveal_line: string | null
        back_message: string
        sender_pseudonym_snapshot: string
      } | null = null

      if (postcardInput) {
        const key = postcardInput.postcard_key
        if (!key || key.trim().length === 0) {
          return { data: null, error: { message: 'A Postcard requires a postcard key.', code: 'P0001' } }
        }
        const catalogEntry = postcardCatalog.find((c) => c.key === key && c.is_active)
        if (!catalogEntry) {
          return { data: null, error: { message: 'Unknown postcard.', code: 'P0001' } }
        }
        const currentVersion = postcardVersions.find((v) => v.postcard_key === key && v.is_current)
        if (!currentVersion) {
          return { data: null, error: { message: 'This postcard has no current version available.', code: 'P0001' } }
        }
        const revealLine = postcardInput.reveal_line
        if (revealLine !== null && revealLine.length > 32) {
          return { data: null, error: { message: "A Postcard's Reveal Line is too long.", code: 'P0001' } }
        }
        const backMessage = (postcardInput.back_message ?? '').trim()
        if (backMessage.length === 0) {
          return {
            data: null,
            error: { message: 'A Postcard needs its own written message before it can be published.', code: 'P0001' },
          }
        }
        if (backMessage.length > 200) {
          return { data: null, error: { message: "A Postcard's back message is too long.", code: 'P0001' } }
        }
        const authorProfile = profiles.find((p) => p.id === viewerId)
        if (!authorProfile) {
          return { data: null, error: { message: 'Could not resolve your pseudonym for this Postcard.', code: 'P0001' } }
        }
        resolvedPostcard = {
          postcard_version_id: currentVersion.id,
          reveal_line: revealLine,
          back_message: backMessage,
          sender_pseudonym_snapshot: authorProfile.pseudonym,
        }
      }

      const row: FakeDispatchRow = {
        id: `dispatch-${rows.length + 1}`,
        author_id: viewerId,
        title,
        body: (params?.p_body as string) ?? '',
        status: 'published',
        published_at: new Date().toISOString(),
        // Independent review item 5 (final audit round) — mirrors the
        // column default / dispatches_insert_own's tightened WITH
        // CHECK: a fresh insert always lands visible/unmoderated.
        moderation_status: 'visible',
      }
      rows.push(row)
      for (const topic of topics) {
        topics_push(row.id, topic)
      }
      // Checkpoint 1C, test category F: mirrors the migration's single
      // transaction inserting the Dispatch row, its topics, AND its
      // Moments together — proving the client-facing publish call is
      // atomic across all three, not just title/body.
      const draftMoments = (params?.p_moments as { position: number; image_path: string }[] | undefined) ?? []
      for (const m of draftMoments) {
        moments.push({ id: `moment-${moments.length + 1}`, dispatch_id: row.id, position: m.position, image_path: m.image_path })
      }
      // Inserted atomically with the Dispatch itself, same as the real
      // publish_dispatch — max one row per dispatch_id by construction
      // (a brand-new dispatch_id every call).
      if (resolvedPostcard) {
        dispatchPostcards.push({ dispatch_id: row.id, ...resolvedPostcard })
      }
      return { data: row, error: null }
    }
    if (fn === 'search_dispatches') {
      const q = ((params?.p_query as string) ?? '').toLowerCase()
      const matches = visibleRows().filter(
        (r) =>
          r.status === 'published' &&
          r.moderation_status === 'visible' &&
          (r.title.toLowerCase().includes(q) ||
            r.body.toLowerCase().includes(q) ||
            topics.some((t) => t.dispatch_id === r.id && t.topic.toLowerCase().includes(q)))
      )
      // Board Feed Foundation checkpoint (Phase 2A): mirrors
      // search_dispatches' own new hard cap (docs/sql/2026-09-22-board-
      // feed-foundation.sql) — was previously unbounded.
      const SEARCH_HARD_CAP = 50
      return {
        data: matches.sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, SEARCH_HARD_CAP),
        error: null,
      }
    }
    // Board Personalization checkpoint — mirrors public.board_feed_page
    // (docs/sql/2026-09-26-board-personalization-ranking.sql) closely
    // enough to test its OBSERVABLE properties (session-stable unseen/
    // seen partition, the nested Keep:Correspondent then Familiar:
    // Discovery weighted interleave, author diversity, bounded familiar-
    // author augmentation, keyset cursor correctness) in pure JS, without
    // a live Postgres to run the real SQL against. The seed_hash
    // tie-break below does not need to reproduce Postgres's own
    // hashtext() byte-for-byte — only to be a deterministic,
    // seed-and-id-dependent function, which is all the real property
    // (same seed -> same order; a different seed CAN reorder a tie)
    // actually requires. rank_key is returned as a STRING, mirroring how
    // supabase-js deserializes a PostgreSQL `numeric` column — never a
    // JS number, matching the real RPC's own contract.
    if (fn === 'board_feed_page') {
      const sessionStartedAt = params?.p_session_started_at as string
      const seed = params?.p_seed as string
      const limit = (params?.p_limit as number) ?? 12
      const cursor =
        params?.p_cursor_seen_bucket == null
          ? null
          : {
              seenBucket: params.p_cursor_seen_bucket as number,
              rankKey: Number(params.p_cursor_rank_key as string | number),
              seedHash: params.p_cursor_seed_hash as number,
              id: params.p_cursor_id as string,
            }

      function seedHash(id: string): number {
        let h = 2166136261
        const combined = `${seed}${id}`
        for (let i = 0; i < combined.length; i++) {
          h ^= combined.charCodeAt(i)
          h = Math.imul(h, 16777619)
        }
        return h | 0
      }

      const SENTINEL_PAST = '2000-01-01T00:00:00Z'

      function seenPreSession(dispatchId: string): boolean {
        return views.some((v) => {
          if (v.viewer_id !== viewerId || v.dispatch_id !== dispatchId) return false
          const firstViewedAt = v.first_viewed_at ?? v.viewed_at ?? SENTINEL_PAST
          return firstViewedAt < sessionStartedAt
        })
      }

      const eligibleGlobal = visibleRows()
        .filter((r) => r.status === 'published' && r.moderation_status === 'visible')
        .filter((r) => r.published_at <= sessionStartedAt)
        .sort((a, b) => b.published_at.localeCompare(a.published_at))
        .slice(0, 300)

      // Familiar authors — Keep beats an established correspondent when
      // both are true for the same author (never stacked). Full block
      // (defense-in-depth, mirroring the migration's own explicit
      // is_blocked_pair check) excludes a candidate author entirely;
      // Stop Letters (a 'letters'-scope block) is NEVER checked here —
      // isBlockedPair only ever trips on 'full', matching the real
      // helper board_feed_page itself calls.
      const isKeptByAuthor = new Map<string, boolean>()
      for (const k of kept) {
        if (k.viewer_user_id !== viewerId) continue
        if ((k.created_at ?? SENTINEL_PAST) >= sessionStartedAt) continue
        if (isBlockedPair(viewerId, k.kept_user_id)) continue
        isKeptByAuthor.set(k.kept_user_id, true)
      }
      for (const c of correspondences) {
        if (c.status !== 'active' || !c.established_at) continue
        if (c.established_at >= sessionStartedAt) continue
        if (c.participant_low !== viewerId && c.participant_high !== viewerId) continue
        const otherAuthor = c.participant_low === viewerId ? c.participant_high : c.participant_low
        if (isBlockedPair(viewerId, otherAuthor)) continue
        if (!isKeptByAuthor.has(otherAuthor)) isKeptByAuthor.set(otherAuthor, false)
      }
      const familiarAuthorIds = [...isKeptByAuthor.keys()]

      // Bounded per-familiar-author augmentation: up to 2 most recent
      // UNSEEN eligible Dispatches per familiar author, mirroring the
      // real migration's LATERAL ... ORDER BY published_at DESC LIMIT 2.
      const augmentRows: FakeDispatchRow[] = []
      for (const authorId of familiarAuthorIds) {
        const authorUnseenEligible = visibleRows()
          .filter((r) => r.author_id === authorId)
          .filter((r) => r.status === 'published' && r.moderation_status === 'visible')
          .filter((r) => r.published_at <= sessionStartedAt)
          .filter((r) => !seenPreSession(r.id))
          .sort((a, b) => b.published_at.localeCompare(a.published_at))
          .slice(0, 2)
        augmentRows.push(...authorUnseenEligible)
      }

      const combinedById = new Map<string, FakeDispatchRow>()
      for (const r of eligibleGlobal) combinedById.set(r.id, r)
      for (const r of augmentRows) combinedById.set(r.id, r)

      const classified = [...combinedById.values()].map((r) => {
        const isKept = isKeptByAuthor.get(r.author_id) ?? false
        const isFamiliar = isKeptByAuthor.has(r.author_id)
        const seenBucket = seenPreSession(r.id) ? 1 : 0
        return { ...r, is_kept: isKept, is_familiar: isFamiliar, seen_bucket: seenBucket, seed_hash: seedHash(r.id) }
      })

      // Author diversity — computed once per (seen_bucket, author_id),
      // since is_kept/is_familiar are per-author facts: a given author's
      // rows always fall entirely within exactly one of the three
      // streams below, never split across them (mirrors the real
      // migration's own author_diverse CTE and its comment on why a
      // single computation suffices).
      const authorSeqByBucketAuthor = new Map<string, number>()
      const authorDiverse = [...classified]
        .sort((a, b) => b.published_at.localeCompare(a.published_at))
        .map((r) => {
          const key = `${r.seen_bucket}:${r.author_id}`
          const next = (authorSeqByBucketAuthor.get(key) ?? 0) + 1
          authorSeqByBucketAuthor.set(key, next)
          return { ...r, author_seq: next }
        })

      type Streamed = (typeof authorDiverse)[number]
      function streamRank(bucket: number, rows: Streamed[]): Map<string, number> {
        const inBucket = rows
          .filter((r) => r.seen_bucket === bucket)
          .sort((a, b) => (a.author_seq !== b.author_seq ? a.author_seq - b.author_seq : a.seed_hash - b.seed_hash))
        const result = new Map<string, number>()
        inBucket.forEach((r, i) => result.set(r.id, i + 1))
        return result
      }

      const rankKeyById = new Map<string, number>()
      for (const bucket of [0, 1]) {
        const keepRows = authorDiverse.filter((r) => r.is_kept)
        const secondSignalRows = authorDiverse.filter((r) => r.is_familiar && !r.is_kept)
        const discoveryRows = authorDiverse.filter((r) => !r.is_familiar)

        const keepStreamI = streamRank(bucket, keepRows)
        const secondStreamI = streamRank(bucket, secondSignalRows)
        const discoveryStreamI = streamRank(bucket, discoveryRows)

        // Level 1: Keep:second-signal = 3:1 — Sainte-Laguë divisor key
        // (2i-1)/w, w=3 for Keep, w=1 for the second signal.
        const familiarMerged: { id: string; kcKey: number }[] = []
        for (const [id, i] of keepStreamI) familiarMerged.push({ id, kcKey: (2 * i - 1) / 3 })
        for (const [id, i] of secondStreamI) familiarMerged.push({ id, kcKey: (2 * i - 1) / 1 })
        const seedHashById = new Map(authorDiverse.map((r) => [r.id, r.seed_hash]))
        familiarMerged.sort((a, b) => {
          if (a.kcKey !== b.kcKey) return a.kcKey - b.kcKey
          return seedHashById.get(a.id)! - seedHashById.get(b.id)!
        })
        const familiarI = new Map<string, number>()
        familiarMerged.forEach((r, i) => familiarI.set(r.id, i + 1))

        // Level 2: Familiar:Discovery = 1:1, unbiased — same (2i-1)/1
        // formula on both sides, ties resolved purely by seed_hash.
        for (const [id, i] of familiarI) rankKeyById.set(id, 2 * i - 1)
        for (const [id, i] of discoveryStreamI) rankKeyById.set(id, 2 * i - 1)
      }

      const ranked = authorDiverse.map((r) => ({ ...r, rank_key: rankKeyById.get(r.id)! }))

      ranked.sort((a, b) => {
        if (a.seen_bucket !== b.seen_bucket) return a.seen_bucket - b.seen_bucket
        if (a.rank_key !== b.rank_key) return a.rank_key - b.rank_key
        if (a.seed_hash !== b.seed_hash) return a.seed_hash - b.seed_hash
        return a.id.localeCompare(b.id)
      })

      function tupleGreaterThanCursor(r: (typeof ranked)[number]): boolean {
        if (!cursor) return true
        if (r.seen_bucket !== cursor.seenBucket) return r.seen_bucket > cursor.seenBucket
        if (r.rank_key !== cursor.rankKey) return r.rank_key > cursor.rankKey
        if (r.seed_hash !== cursor.seedHash) return r.seed_hash > cursor.seedHash
        return r.id > cursor.id
      }

      const page = ranked.filter(tupleGreaterThanCursor).slice(0, limit)

      return {
        data: page.map((r) => ({
          id: r.id,
          author_id: r.author_id,
          title: r.title,
          body: r.body,
          published_at: r.published_at,
          moderation_status: r.moderation_status,
          is_kept: r.is_kept,
          is_familiar: r.is_familiar,
          seen_bucket: r.seen_bucket,
          rank_key: String(r.rank_key),
          seed_hash: r.seed_hash,
        })),
        error: null,
      }
    }
    // Mirrors share_dispatch's own validation order and get-or-create
    // behavior (see docs/sql/2026-09-07-dispatches-and-board.sql,
    // broadened by docs/sql/2026-09-09-board-usability.sql) — ANY
    // authenticated member + published status (no author check, as of
    // the Board usability checkpoint), then reuse a live share if one
    // exists, otherwise create one. The SQL migration's own
    // dispatch_shares_one_active_per_dispatch index is the real
    // authority for "at most one active share"; this stand-in just
    // never creates a second live row for the same dispatch_id either.
    if (fn === 'share_dispatch') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const dispatchId = params?.p_dispatch_id as string
      const dispatch = rows.find((r) => r.id === dispatchId)
      if (!dispatch || dispatch.status !== 'published') {
        return {
          data: null,
          error: { message: 'Only a published Dispatch may be shared.', code: 'P0001' },
        }
      }
      let share = shares.find((s) => s.dispatch_id === dispatchId && s.revoked_at === null)
      if (!share) {
        share = { id: `share-${shares.length + 1}`, dispatch_id: dispatchId, revoked_at: null }
        shares.push(share)
      }
      return { data: share, error: null }
    }
    if (fn === 'revoke_dispatch_share') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const dispatchId = params?.p_dispatch_id as string
      const dispatch = rows.find((r) => r.id === dispatchId)
      if (!dispatch || dispatch.author_id !== viewerId) {
        return {
          data: null,
          error: { message: 'Only the author of a Dispatch may stop sharing it.', code: 'P0001' },
        }
      }
      const share = shares.find((s) => s.dispatch_id === dispatchId && s.revoked_at === null)
      if (share) share.revoked_at = new Date().toISOString()
      return { data: null, error: null }
    }
    // Mirrors get_shared_dispatch's own contract: an invalid, revoked,
    // or not-currently-published token all resolve to the same empty
    // result — zero rows, never an error, never another Dispatch's
    // data (see the migration's own doc comment for why that ambiguity
    // is deliberate).
    if (fn === 'get_shared_dispatch') {
      const token = params?.p_token as string
      const share = shares.find((s) => s.id === token && s.revoked_at === null)
      const dispatch = share
        ? rows.find((r) => r.id === share.dispatch_id && r.status === 'published' && r.moderation_status === 'visible')
        : undefined
      if (!share || !dispatch) return { data: [], error: null }

      const pseudonym = profiles.find((p) => p.id === dispatch.author_id)?.pseudonym ?? 'A TEMPA member'
      const dispatchTopics = topics
        .filter((t) => t.dispatch_id === dispatch.id)
        .map((t) => t.topic)
        .sort()
      const dispatchMoments = moments
        .filter((m) => m.dispatch_id === dispatch.id)
        .sort((a, b) => a.position - b.position)
        .map((m) => ({ id: m.id, position: m.position, image_path: m.image_path }))

      // Dispatch Postcards Checkpoint 2 — resolved the same way the real
      // SECURITY DEFINER function does: joined through dispatch_postcards
      // -> postcard_versions, bundled into one jsonb-shaped object;
      // undefined (never queried at all) when the Dispatch has none,
      // matching the real RPC's own null-via-empty-subselect behavior.
      const dispatchPostcard = dispatchPostcards.find((p) => p.dispatch_id === dispatch.id)
      const postcardVersion = dispatchPostcard
        ? postcardVersions.find((v) => v.id === dispatchPostcard.postcard_version_id)
        : undefined
      const postcard =
        dispatchPostcard && postcardVersion
          ? {
              title: postcardVersion.title,
              location: postcardVersion.location,
              collection: postcardVersion.collection,
              postmark_text: postcardVersion.postmark_text,
              footer_text: postcardVersion.footer_text,
              front_image_path: postcardVersion.front_image_path,
              motion_src: postcardVersion.motion_src ?? null,
              duration_seconds: postcardVersion.duration_seconds ?? null,
              reveal_line_alignment: postcardVersion.reveal_line_alignment ?? null,
              reveal_line: dispatchPostcard.reveal_line,
              back_message: dispatchPostcard.back_message,
              sender_pseudonym_snapshot: dispatchPostcard.sender_pseudonym_snapshot,
            }
          : undefined

      return {
        data: [
          {
            dispatch_id: dispatch.id,
            title: dispatch.title,
            body: dispatch.body,
            published_at: dispatch.published_at,
            author_pseudonym: pseudonym,
            topics: dispatchTopics,
            moments: dispatchMoments,
            postcard,
          },
        ],
        error: null,
      }
    }
    // Mirrors update_dispatch: author + published only, same title/
    // topic validation as publish, wholesale-replaces topics, never
    // touches dispatch_shares (an active token survives untouched).
    // Independent review item 4: a HIDDEN Dispatch is not editable by
    // its own still-active author either — folded into the same
    // existence check, reusing the existing message.
    if (fn === 'update_dispatch') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const dispatchId = params?.p_dispatch_id as string
      const dispatch = rows.find((r) => r.id === dispatchId)
      if (
        !dispatch ||
        dispatch.author_id !== viewerId ||
        dispatch.status !== 'published' ||
        dispatch.moderation_status !== 'visible'
      ) {
        return {
          data: null,
          error: { message: 'Only the author of a published Dispatch may edit it.', code: 'P0001' },
        }
      }
      const title = (params?.p_title as string) ?? ''
      if (title.trim().length === 0) {
        return { data: null, error: { message: 'A Dispatch needs a title.', code: 'P0001' } }
      }
      if (title.length > 70) {
        return { data: null, error: { message: 'Title is too long.', code: 'P0001' } }
      }
      const newTopics = (params?.p_topics as string[]) ?? []
      if (newTopics.length > 3) {
        return { data: null, error: { message: 'A Dispatch may carry at most 3 topics.', code: 'P0001' } }
      }
      dispatch.title = title
      dispatch.body = (params?.p_body as string) ?? ''
      for (let i = topics.length - 1; i >= 0; i--) {
        if (topics[i].dispatch_id === dispatchId) topics.splice(i, 1)
      }
      for (const topic of newTopics) topics_push(dispatchId, topic)
      return { data: dispatch, error: null }
    }
    // Mirrors delete_dispatch: author-only, then the same cascades the
    // live FK constraints perform (topics, shares, and un-pinning any
    // profile that had this Dispatch pinned). Independent review item
    // 4: a HIDDEN Dispatch is not deletable by its own still-active
    // author either — folded into the same existence check, reusing the
    // existing message. Board Experience Phase 2B pre-SQL correction
    // pass: a Dispatch with any dispatch_replies row — its own author's
    // or another member's — can no longer be hard-deleted, mirroring
    // delete_dispatch's own new guard exactly (docs/sql/2026-09-23-
    // dispatch-replies.sql piece 2).
    if (fn === 'delete_dispatch') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const dispatchId = params?.p_dispatch_id as string
      const dispatch = rows.find((r) => r.id === dispatchId)
      if (!dispatch || dispatch.author_id !== viewerId || dispatch.moderation_status !== 'visible') {
        return { data: null, error: { message: 'Only the author of a Dispatch may delete it.', code: 'P0001' } }
      }
      if (replies.some((r) => r.dispatch_id === dispatchId)) {
        return {
          data: null,
          error: { message: 'This Dispatch cannot be deleted while it still has Replies.', code: 'P0001' },
        }
      }
      rows.splice(rows.indexOf(dispatch), 1)
      for (let i = topics.length - 1; i >= 0; i--) {
        if (topics[i].dispatch_id === dispatchId) topics.splice(i, 1)
      }
      for (let i = shares.length - 1; i >= 0; i--) {
        if (shares[i].dispatch_id === dispatchId) shares.splice(i, 1)
      }
      for (const profile of profiles) {
        if (profile.pinned_dispatch_id === dispatchId) profile.pinned_dispatch_id = null
      }
      return { data: null, error: null }
    }
    // Mirrors pin_dispatch: author + published only, a single
    // "replace" write onto the caller's own profile row.
    if (fn === 'pin_dispatch') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const dispatchId = params?.p_dispatch_id as string
      const dispatch = rows.find((r) => r.id === dispatchId)
      if (!dispatch || dispatch.author_id !== viewerId || dispatch.status !== 'published') {
        return {
          data: null,
          error: { message: 'Only the author of a published Dispatch may pin it.', code: 'P0001' },
        }
      }
      const profile = profiles.find((p) => p.id === viewerId)
      if (profile) profile.pinned_dispatch_id = dispatchId
      return { data: null, error: null }
    }
    // Mirrors unpin_dispatch: clears the caller's own pin; a no-op if
    // nothing was pinned.
    if (fn === 'unpin_dispatch') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const profile = profiles.find((p) => p.id === viewerId)
      if (profile) profile.pinned_dispatch_id = null
      return { data: null, error: null }
    }
    // Safety & Trust Checkpoint 1B — mirrors keep_mind: self/blocked
    // rejection, then an idempotent (ON CONFLICT DO NOTHING) insert.
    if (fn === 'keep_mind') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const keptUserId = params?.p_kept_user_id as string
      if (viewerId === keptUserId) {
        return { data: null, error: { message: 'You cannot Keep yourself in mind.', code: 'P0001' } }
      }
      if (isBlockedPair(viewerId, keptUserId)) {
        return { data: null, error: { message: 'This action is not available right now.', code: 'P0001' } }
      }
      if (!kept.some((k) => k.viewer_user_id === viewerId && k.kept_user_id === keptUserId)) {
        kept.push({ viewer_user_id: viewerId, kept_user_id: keptUserId })
      }
      return { data: null, error: null }
    }
    // Mirrors unkeep_mind: de-escalating, no block/status check.
    if (fn === 'unkeep_mind') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const keptUserId = params?.p_kept_user_id as string
      for (let i = kept.length - 1; i >= 0; i--) {
        if (kept[i].viewer_user_id === viewerId && kept[i].kept_user_id === keptUserId) kept.splice(i, 1)
      }
      return { data: null, error: null }
    }
    // Mirrors block_user (Checkpoint 1C: docs/sql/2026-09-12-scoped-
    // blocking-and-fixes.sql) — self-rejection, scope validation, an
    // idempotent insert that atomically UPDATEs scope on conflict (so a
    // second call with a different scope upgrades or downgrades rather
    // than erroring), and the kept_minds cascade ONLY when the
    // resulting scope is 'full' — a letters-only block, whether newly
    // created or arrived at by downgrading from full, never deletes or
    // restores Keep.
    if (fn === 'block_user') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const blockedId = params?.p_blocked_id as string
      const scope = (params?.p_scope as 'letters' | 'full' | undefined) ?? 'full'
      if (scope !== 'letters' && scope !== 'full') {
        return { data: null, error: { message: 'Unknown block scope.', code: 'P0001' } }
      }
      if (viewerId === blockedId) {
        return { data: null, error: { message: 'You cannot block yourself.', code: 'P0001' } }
      }
      const existing = blocked.find((b) => b.blocker_id === viewerId && b.blocked_id === blockedId)
      if (existing) {
        existing.scope = scope
      } else {
        blocked.push({ blocker_id: viewerId, blocked_id: blockedId, scope, created_at: new Date().toISOString() })
      }
      if (scope === 'full') {
        for (let i = kept.length - 1; i >= 0; i--) {
          const k = kept[i]
          const matchesEitherDirection =
            (k.viewer_user_id === viewerId && k.kept_user_id === blockedId) ||
            (k.viewer_user_id === blockedId && k.kept_user_id === viewerId)
          if (matchesEitherDirection) kept.splice(i, 1)
        }
        // Board Phase 2C, FINAL SECURITY/HARDENING PATCH — mirrors
        // block_user's own new dispatch_worth_reading cleanup exactly
        // (docs/sql/2026-09-24-dispatch-worth-reading.sql piece 3): a
        // FULL block clears any Worth Reading mark between the pair in
        // BOTH directions — the caller's own mark on blockedId's
        // Dispatch, and blockedId's own mark on the caller's Dispatch —
        // same shape as the Keep cascade immediately above. A 'letters'
        // scope never enters this branch, so it never touches Worth
        // Reading either.
        const dispatchAuthor = (dispatchId: string) => rows.find((r) => r.id === dispatchId)?.author_id
        for (let i = worthReading.length - 1; i >= 0; i--) {
          const w = worthReading[i]
          const matchesEitherDirection =
            (w.user_id === viewerId && dispatchAuthor(w.dispatch_id) === blockedId) ||
            (w.user_id === blockedId && dispatchAuthor(w.dispatch_id) === viewerId)
          if (matchesEitherDirection) worthReading.splice(i, 1)
        }
      }
      return { data: null, error: null }
    }
    // Mirrors unblock_user: only the caller's own block row, never
    // restores kept_minds.
    // Mirrors get_blocked_profiles: pseudonym resolution for the
    // caller's OWN blocked_users rows only, bypassing the block-aware
    // public_profiles exclusion for exactly that narrow, self-scoped
    // case.
    if (fn === 'get_blocked_profiles') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const rows = blocked
        .filter((b) => b.blocker_id === viewerId)
        .map((b) => {
          const p = profiles.find((profile) => profile.id === b.blocked_id)
          return {
            id: b.blocked_id,
            pseudonym: p?.pseudonym ?? 'A member',
            country: p?.country ?? null,
            scope: b.scope ?? 'full',
            created_at: b.created_at ?? new Date().toISOString(),
          }
        })
      return { data: rows, error: null }
    }
    if (fn === 'unblock_user') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const blockedId = params?.p_blocked_id as string
      for (let i = blocked.length - 1; i >= 0; i--) {
        if (blocked[i].blocker_id === viewerId && blocked[i].blocked_id === blockedId) blocked.splice(i, 1)
      }
      return { data: null, error: null }
    }
    // Board Experience Phase 2B — mirrors create_reply (docs/sql/2026-
    // 09-23-dispatch-replies.sql) validation order exactly: auth,
    // account status, body validity, Dispatch existence/eligibility,
    // Dispatch-author blocking, then (only when replying to a Reply)
    // parent existence/same-dispatch/eligibility/blocking, deriving
    // reply_to_user_id and root_reply_id server-side — never from
    // params.
    if (fn === 'create_reply') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const status = accountStatus[viewerId] ?? 'active'
      if (status === 'restricted' || status === 'suspended' || status === 'banned') {
        return { data: null, error: { message: 'This action is not available right now.', code: 'P0001' } }
      }
      const body = ((params?.p_body as string) ?? '').trim()
      if (body.length === 0) {
        return { data: null, error: { message: 'A Reply needs some writing.', code: 'P0001' } }
      }
      if (body.length > 500) {
        return { data: null, error: { message: 'Reply is too long.', code: 'P0001' } }
      }
      const dispatchId = params?.p_dispatch_id as string
      const dispatch = rows.find((r) => r.id === dispatchId)
      if (!dispatch) {
        return { data: null, error: { message: 'Dispatch not found.', code: 'P0001' } }
      }
      if (dispatch.status !== 'published' || dispatch.moderation_status !== 'visible') {
        return { data: null, error: { message: 'This Dispatch is not open to Replies right now.', code: 'P0001' } }
      }
      // Final security review correction: SECURITY DEFINER bypasses RLS
      // entirely, so this reproduces the Dispatch author's own public-
      // visibility check too (suspended/banned rejected), not just
      // blocking — same as the real RPC now does.
      if (isBlockedPair(viewerId, dispatch.author_id) || !authorContentPubliclyVisible(dispatch.author_id)) {
        return { data: null, error: { message: 'This action is not available right now.', code: 'P0001' } }
      }

      const parentReplyId = (params?.p_parent_reply_id as string | null | undefined) ?? null
      let rootReplyId: string | null = null
      let replyToUserId: string | null = null

      if (parentReplyId !== null) {
        const parent = replies.find((r) => r.id === parentReplyId)
        if (!parent) {
          return { data: null, error: { message: 'The Reply you are answering no longer exists.', code: 'P0001' } }
        }
        if (parent.dispatch_id !== dispatchId) {
          return { data: null, error: { message: 'That Reply does not belong to this Dispatch.', code: 'P0001' } }
        }
        if (parent.moderation_status !== 'visible' || parent.deleted_at !== null) {
          return { data: null, error: { message: 'That Reply is no longer available to answer.', code: 'P0001' } }
        }
        // Same correction, applied to the parent Reply's own author.
        if (isBlockedPair(viewerId, parent.author_id) || !authorContentPubliclyVisible(parent.author_id)) {
          return { data: null, error: { message: 'This action is not available right now.', code: 'P0001' } }
        }
        replyToUserId = parent.author_id
        rootReplyId = parent.root_reply_id ?? parent.id
      }

      const newReply: FakeReplyRow = {
        id: `reply-${replies.length + 1}`,
        dispatch_id: dispatchId,
        author_id: viewerId,
        body,
        parent_reply_id: parentReplyId,
        root_reply_id: rootReplyId,
        reply_to_user_id: replyToUserId,
        moderation_status: 'visible',
        deleted_at: null,
        created_at: new Date().toISOString(),
      }
      replies.push(newReply)
      return { data: newReply, error: null }
    }

    // Mirrors delete_reply: author-only tombstone, never gated on
    // account status or blocking (a de-escalating action, same
    // reasoning as unkeep_mind above) — clears body and sets deleted_at
    // together, leaves every other field (including parent_reply_id/
    // root_reply_id/reply_to_user_id) untouched.
    if (fn === 'delete_reply') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const replyId = params?.p_reply_id as string
      const reply = replies.find((r) => r.id === replyId && r.author_id === viewerId && r.deleted_at === null)
      if (!reply) {
        return { data: null, error: { message: 'Reply not found.', code: 'P0001' } }
      }
      reply.deleted_at = new Date().toISOString()
      reply.body = ''
      return { data: null, error: null }
    }

    // Board Experience Phase 2C — mirrors set_dispatch_worth_reading
    // (docs/sql/2026-09-24-dispatch-worth-reading.sql) validation order
    // exactly: auth first; the false (undo) direction is de-escalating
    // and handled BEFORE the account-status/blocking/Dispatch-state
    // checks below, so it stays available regardless of any of them
    // (same reasoning as unkeep_mind/delete_reply above). The true
    // direction then reproduces create_reply's own eligibility shape —
    // account status, Dispatch existence/published+visible, own-
    // Dispatch rejection, full-block check, author public-visibility —
    // before an idempotent (ON CONFLICT DO NOTHING) insert.
    if (fn === 'set_dispatch_worth_reading') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const dispatchId = params?.p_dispatch_id as string
      const worthReadingValue = params?.p_worth_reading as boolean | null | undefined

      // FINAL SECURITY/HARDENING PATCH, correction A: NULL is rejected
      // explicitly, BEFORE the false-branch check below — mirrors the
      // migration's own reasoning exactly: a bare `worthReadingValue ===
      // false` check would let NULL/undefined silently fall through to
      // the true-branch logic below instead of being refused outright.
      if (worthReadingValue === null || worthReadingValue === undefined) {
        return { data: null, error: { message: 'Worth Reading state is required.', code: 'P0001' } }
      }

      if (worthReadingValue === false) {
        for (let i = worthReading.length - 1; i >= 0; i--) {
          if (worthReading[i].dispatch_id === dispatchId && worthReading[i].user_id === viewerId) {
            worthReading.splice(i, 1)
          }
        }
        return { data: null, error: null }
      }

      const status = accountStatus[viewerId] ?? 'active'
      if (status === 'restricted' || status === 'suspended' || status === 'banned') {
        return { data: null, error: { message: 'This action is not available right now.', code: 'P0001' } }
      }
      const dispatch = rows.find((r) => r.id === dispatchId)
      if (!dispatch) {
        return { data: null, error: { message: 'Dispatch not found.', code: 'P0001' } }
      }
      if (dispatch.status !== 'published' || dispatch.moderation_status !== 'visible') {
        return { data: null, error: { message: 'This Dispatch is not available right now.', code: 'P0001' } }
      }
      if (dispatch.author_id === viewerId) {
        return {
          data: null,
          error: { message: 'You cannot mark your own Dispatch worth reading.', code: 'P0001' },
        }
      }
      if (isBlockedPair(viewerId, dispatch.author_id)) {
        return { data: null, error: { message: 'This action is not available right now.', code: 'P0001' } }
      }
      if (!authorContentPubliclyVisible(dispatch.author_id)) {
        return { data: null, error: { message: 'This action is not available right now.', code: 'P0001' } }
      }
      if (!worthReading.some((w) => w.dispatch_id === dispatchId && w.user_id === viewerId)) {
        worthReading.push({ dispatch_id: dispatchId, user_id: viewerId, created_at: new Date().toISOString() })
      }
      return { data: null, error: null }
    }

    throw new Error(`fakeDispatches: no rpc handler for "${fn}"`)
  }

  function topics_push(dispatchId: string, topic: string) {
    topics.push({ dispatch_id: dispatchId, topic })
  }

  return {
    from,
    rpc,
    storage,
    /** Test-only escape hatch — e.g. to flip a row's moderation_status
     * directly, standing in for admin_hide_dispatch/admin_restore_dispatch
     * (which this fake doesn't model; see admin-moderation.test.ts's
     * simulate-RPC suite for that layer). */
    _rows: rows,
    /** Test-only escape hatch onto the underlying Reply rows — e.g. to
     * flip moderation_status directly, standing in for admin_hide_reply/
     * admin_restore_reply (modeled instead in simulateReportRpcs.ts). */
    _replies: replies,
    /** Test-only escape hatch onto the underlying Worth Reading rows —
     * e.g. to assert a mark's presence/absence directly rather than
     * only through isDispatchWorthReading's own RLS-scoped read. */
    _worthReading: worthReading,
    /** Dispatch Postcards Checkpoint 2 — test-only escape hatch onto the
     * rows publish_dispatch's own fake mutation actually wrote, e.g. to
     * assert the max-one-per-dispatch/exact-current-version-captured
     * properties directly rather than only through a subsequent read. */
    _dispatchPostcards: dispatchPostcards,
  }
}
