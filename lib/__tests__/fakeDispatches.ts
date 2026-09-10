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
export type FakeKeptRow = { viewer_user_id: string; kept_user_id: string }
export type FakeViewRow = { viewer_id: string; dispatch_id: string; last_paragraph_index: number }
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

export function createFakeDispatches(options: {
  viewerId: string | null
  rows: FakeDispatchRow[]
  profiles?: FakeProfileRow[]
  topics?: FakeTopicRow[]
  kept?: FakeKeptRow[]
  views?: FakeViewRow[]
  shares?: FakeShareRow[]
  moments?: FakeMomentRow[]
  blocked?: FakeBlockRow[]
}) {
  const { viewerId } = options
  const rows = options.rows
  for (const r of rows) if (r.moderation_status === undefined) r.moderation_status = 'visible'
  const profiles = options.profiles ?? []
  const topics = options.topics ?? []
  const kept = options.kept ?? []
  const views = options.views ?? []
  const shares = options.shares ?? []
  const moments = options.moments ?? []
  const blocked = options.blocked ?? []

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
          !isBlockedPair(viewerId, r.author_id)) ||
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

  function from(table: string) {
    if (table === 'dispatches') return dispatchesFrom()
    if (table === 'public_profiles' || table === 'profiles') return profilesFrom()
    if (table === 'dispatch_topics') return topicsFrom()
    if (table === 'kept_minds') return keptMindsFrom()
    if (table === 'dispatch_views') return viewsFrom()
    if (table === 'dispatch_shares') return sharesFrom()
    if (table === 'blocked_users') return blockedUsersFrom()
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
      return { data: matches.sort((a, b) => b.published_at.localeCompare(a.published_at)), error: null }
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
    // existing message.
    if (fn === 'delete_dispatch') {
      if (!viewerId) {
        return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      }
      const dispatchId = params?.p_dispatch_id as string
      const dispatch = rows.find((r) => r.id === dispatchId)
      if (!dispatch || dispatch.author_id !== viewerId || dispatch.moderation_status !== 'visible') {
        return { data: null, error: { message: 'Only the author of a Dispatch may delete it.', code: 'P0001' } }
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
  }
}
