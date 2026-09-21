// A validation-order simulation of the Postcard Admin + Keepsakes RPCs
// in docs/sql/2026-09-21-postcard-admin-and-keepsakes.sql — same
// convention as simulateReportRpcs.ts/simulateQuestionRpcs.ts: this
// proves the client-facing call shape and the documented validation
// ORDER, not live Postgres/RLS behavior itself (that migration is
// prepared but not executed). The SQL migration text is the actual
// authority for exact wording/behavior.

export type FakeProfile = { id: string; pseudonym: string }

export type FakePostcardCatalog = {
  key: string
  title: string
  countryCode: string
  isActive: boolean
  createdAt?: string
}

export type FakePostcardVersion = {
  id: string
  postcardKey: string
  versionNumber: number
  title: string
  location: string
  collection: string
  postmarkText: string
  footerText: string
  storyText?: string
  frontImagePath: string
  motionSrc?: string | null
  durationSeconds?: number | null
  revealLineAlignment?: string | null
  isCurrent: boolean
}

// Mirrors the columns of the already-live `letters` table this
// simulator actually needs — not a full fixture of every letters
// column, same minimal-fixture convention as simulateReportRpcs.ts's
// FakeLetter.
export type FakeLetterForPostcards = {
  id: string
  correspondenceId: string
  senderId: string
  recipientId: string
  deliverAt: string
}

export type FakeLetterPostcard = {
  letterId: string
  postcardVersionId: string
  revealLine: string | null
  backMessage: string
  senderPseudonymSnapshot: string
}

export type FakeKeepsakeRemoval = { userId: string; letterId: string }

export type FakeAuditRow = {
  id: string
  actor_id: string | null
  actor_identifier_snapshot: string
  action: string
  target_type: string
  target_id: string | null
  target_identifier_snapshot: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

const VALID_ALIGNMENTS = [
  'top-left', 'top-center', 'top-right',
  'center',
  'bottom-left', 'bottom-center', 'bottom-right',
]

export function createFakePostcards(options: {
  viewerId: string | null
  now?: string
  profiles?: FakeProfile[]
  staff?: Record<string, 'moderator' | 'admin'>
  catalog?: FakePostcardCatalog[]
  versions?: FakePostcardVersion[]
  letters?: FakeLetterForPostcards[]
  letterPostcards?: FakeLetterPostcard[]
  keepsakeRemovals?: FakeKeepsakeRemoval[]
}) {
  let viewerId = options.viewerId
  const now = options.now ?? new Date().toISOString()
  const profiles = options.profiles ?? []
  const staff = options.staff ?? {}
  const catalog = options.catalog ?? []
  const versions = options.versions ?? []
  const letters = options.letters ?? []
  const letterPostcards = options.letterPostcards ?? []
  const keepsakeRemovals = options.keepsakeRemovals ?? []
  const auditLog: FakeAuditRow[] = []

  for (const c of catalog) if (c.createdAt === undefined) c.createdAt = new Date().toISOString()

  function pseudonymOf(id: string | null) {
    if (!id) return null
    return profiles.find((p) => p.id === id)?.pseudonym ?? null
  }

  function isStaff(callerId: string | null, minRole: 'moderator' | 'admin' = 'moderator') {
    if (!callerId) return false
    const role = staff[callerId]
    if (!role) return false
    if (minRole === 'moderator') return true
    return role === 'admin'
  }

  function currentVersionOf(key: string) {
    return versions.find((v) => v.postcardKey === key && v.isCurrent)
  }

  async function rpc(fn: string, params?: Record<string, unknown>): Promise<{
    data: unknown
    error: { message: string; code: string } | null
  }> {
    if (fn === 'admin_add_story_postcard' || fn === 'admin_create_story_postcard_version') {
      const story = String(params?.p_story_text ?? '').trim()
      if (story.length > 600) {
        return { data: null, error: { message: 'Story must be 600 characters or fewer.', code: 'P0001' } }
      }
      const oldFn = fn === 'admin_add_story_postcard' ? 'admin_add_postcard' : 'admin_create_postcard_version'
      const result = await rpc(oldFn, params)
      if (!result.error && result.data) {
        const version = versions.find((v) => v.id === result.data)
        if (version) version.storyText = story
        if (fn === 'admin_add_story_postcard' && params?.p_stage_inactive === true) {
          await rpc('admin_set_postcard_active', { p_key: String(params?.p_key ?? '').trim().toLowerCase(), p_active: false })
        }
      }
      return result
    }

    if (fn === 'admin_list_postcards') {
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }

      const rows = catalog
        .slice()
        .sort((a, b) => {
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
          return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
        })
        .map((c) => {
          const v = currentVersionOf(c.key)
          if (!v) return null
          const timesSent = letterPostcards.filter((lp) => {
            const vv = versions.find((x) => x.id === lp.postcardVersionId)
            return vv?.postcardKey === c.key
          }).length
          return {
            key: c.key,
            is_active: c.isActive,
            created_at: c.createdAt,
            current_version_id: v.id,
            version_number: v.versionNumber,
            title: v.title,
            country_code: c.countryCode,
            location: v.location,
            collection: v.collection,
            postmark_text: v.postmarkText,
            footer_text: v.footerText,
            front_image_path: v.frontImagePath,
            motion_src: v.motionSrc ?? null,
            duration_seconds: v.durationSeconds ?? null,
            reveal_line_alignment: v.revealLineAlignment ?? null,
            times_sent: timesSent,
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

      return { data: rows, error: null }
    }

    if (fn === 'admin_add_postcard') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }

      const key = String(params?.p_key ?? '').trim().toLowerCase()
      if (key === '') return { data: null, error: { message: 'A postcard key is required.', code: 'P0001' } }
      if (!/^[a-z][a-z0-9_]*$/.test(key)) {
        return {
          data: null,
          error: {
            message: 'Postcard key must start with a letter and contain only lowercase letters, numbers, and underscores.',
            code: 'P0001',
          },
        }
      }
      if (catalog.some((c) => c.key === key)) {
        return { data: null, error: { message: 'A postcard with this key already exists.', code: 'P0001' } }
      }

      const title = String(params?.p_title ?? '').trim()
      const countryCode = String(params?.p_country_code ?? '').trim().toUpperCase()
      const location = String(params?.p_location ?? '').trim()
      const collection = String(params?.p_collection ?? '').trim()
      const postmarkText = String(params?.p_postmark_text ?? '').trim()
      const footerText = String(params?.p_footer_text ?? '').trim()
      const frontImagePath = String(params?.p_front_image_path ?? '').trim()

      if (title === '') return { data: null, error: { message: 'A title is required.', code: 'P0001' } }
      if (countryCode === '') return { data: null, error: { message: 'A country code is required.', code: 'P0001' } }
      if (location === '') return { data: null, error: { message: 'A location is required.', code: 'P0001' } }
      if (collection === '') return { data: null, error: { message: 'A collection name is required.', code: 'P0001' } }
      if (postmarkText === '') return { data: null, error: { message: 'Postmark text is required.', code: 'P0001' } }
      if (footerText === '') return { data: null, error: { message: 'Footer text is required.', code: 'P0001' } }
      if (frontImagePath === '') return { data: null, error: { message: 'Artwork is required.', code: 'P0001' } }

      const alignment = (params?.p_reveal_line_alignment as string | null) ?? null
      if (alignment !== null && !VALID_ALIGNMENTS.includes(alignment)) {
        return { data: null, error: { message: 'Unknown reveal line alignment.', code: 'P0001' } }
      }

      catalog.push({ key, title, countryCode, isActive: true, createdAt: new Date().toISOString() })

      const motionSrc = ((params?.p_motion_src as string | null) ?? '')?.trim() || null
      const newVersion: FakePostcardVersion = {
        id: `pv-${versions.length + 1}`,
        postcardKey: key,
        versionNumber: 1,
        title,
        location,
        collection,
        postmarkText,
        footerText,
        frontImagePath,
        motionSrc,
        durationSeconds: (params?.p_duration_seconds as number | null) ?? null,
        revealLineAlignment: alignment,
        isCurrent: true,
      }
      versions.push(newVersion)

      auditLog.push({
        id: `audit-${auditLog.length + 1}`,
        actor_id: viewerId,
        actor_identifier_snapshot: pseudonymOf(viewerId) ?? viewerId,
        action: 'postcard_created',
        target_type: 'postcard',
        target_id: newVersion.id,
        target_identifier_snapshot: key,
        metadata: { key, title },
        created_at: new Date().toISOString(),
      })

      return { data: newVersion.id, error: null }
    }

    if (fn === 'admin_create_postcard_version') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }

      // Independent SQL review correction pass (2026-09-22) — trim
      // only, NEVER lower(): p_key names an EXISTING, durable,
      // case-sensitive identity (the real live catalogue key
      // `bangkokAfterRain` must remain exactly editable), matching
      // admin_create_postcard_version's own corrected SQL.
      const key = String(params?.p_key ?? '').trim()
      const c = catalog.find((c) => c.key === key)
      if (!c) return { data: null, error: { message: 'Postcard not found.', code: 'P0001' } }

      const title = String(params?.p_title ?? '').trim()
      const location = String(params?.p_location ?? '').trim()
      const collection = String(params?.p_collection ?? '').trim()
      const postmarkText = String(params?.p_postmark_text ?? '').trim()
      const footerText = String(params?.p_footer_text ?? '').trim()
      const frontImagePath = String(params?.p_front_image_path ?? '').trim()

      if (title === '') return { data: null, error: { message: 'A title is required.', code: 'P0001' } }
      if (location === '') return { data: null, error: { message: 'A location is required.', code: 'P0001' } }
      if (collection === '') return { data: null, error: { message: 'A collection name is required.', code: 'P0001' } }
      if (postmarkText === '') return { data: null, error: { message: 'Postmark text is required.', code: 'P0001' } }
      if (footerText === '') return { data: null, error: { message: 'Footer text is required.', code: 'P0001' } }
      if (frontImagePath === '') return { data: null, error: { message: 'Artwork is required.', code: 'P0001' } }

      const alignment = (params?.p_reveal_line_alignment as string | null) ?? null
      if (alignment !== null && !VALID_ALIGNMENTS.includes(alignment)) {
        return { data: null, error: { message: 'Unknown reveal line alignment.', code: 'P0001' } }
      }

      const nextVersionNumber =
        Math.max(0, ...versions.filter((v) => v.postcardKey === key).map((v) => v.versionNumber)) + 1

      for (const v of versions) if (v.postcardKey === key && v.isCurrent) v.isCurrent = false

      const motionSrc = ((params?.p_motion_src as string | null) ?? '')?.trim() || null
      const newVersion: FakePostcardVersion = {
        id: `pv-${versions.length + 1}`,
        postcardKey: key,
        versionNumber: nextVersionNumber,
        title,
        location,
        collection,
        postmarkText,
        footerText,
        frontImagePath,
        motionSrc,
        durationSeconds: (params?.p_duration_seconds as number | null) ?? null,
        revealLineAlignment: alignment,
        isCurrent: true,
      }
      versions.push(newVersion)

      // Keep postcard_catalog.title in sync with the CURRENT version —
      // postcard_catalog.title is "what this Postcard is called right
      // now"; every earlier postcard_versions row (including the one
      // just superseded) keeps its own frozen title untouched.
      c.title = title

      auditLog.push({
        id: `audit-${auditLog.length + 1}`,
        actor_id: viewerId,
        actor_identifier_snapshot: pseudonymOf(viewerId) ?? viewerId,
        action: 'postcard_version_created',
        target_type: 'postcard',
        target_id: newVersion.id,
        target_identifier_snapshot: key,
        metadata: { version_number: nextVersionNumber },
        created_at: new Date().toISOString(),
      })

      return { data: newVersion.id, error: null }
    }

    if (fn === 'admin_set_postcard_active') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }

      const active = params?.p_active as boolean | null | undefined
      if (active === null || active === undefined) {
        return { data: null, error: { message: 'An active state is required.', code: 'P0001' } }
      }

      // Trim only, never lower() — same durable-identity reasoning as
      // admin_create_postcard_version above.
      const key = String(params?.p_key ?? '').trim()
      const c = catalog.find((c) => c.key === key)
      if (!c) return { data: null, error: { message: 'Postcard not found.', code: 'P0001' } }

      if (c.isActive === active && active) {
        return { data: null, error: { message: 'This Postcard is already active.', code: 'P0001' } }
      }
      if (c.isActive === active && !active) {
        return { data: null, error: { message: 'This Postcard is already inactive.', code: 'P0001' } }
      }

      c.isActive = active
      const v = currentVersionOf(key)

      auditLog.push({
        id: `audit-${auditLog.length + 1}`,
        actor_id: viewerId,
        actor_identifier_snapshot: pseudonymOf(viewerId) ?? viewerId,
        action: active ? 'postcard_activated' : 'postcard_deactivated',
        target_type: 'postcard',
        target_id: v?.id ?? null,
        target_identifier_snapshot: key,
        metadata: { is_active: active },
        created_at: new Date().toISOString(),
      })

      return { data: null, error: null }
    }

    if (fn === 'get_my_postcards') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }

      const rows = letterPostcards
        .map((lp) => {
          const l = letters.find((l) => l.id === lp.letterId)
          const v = versions.find((v) => v.id === lp.postcardVersionId)
          if (!l || !v) return null
          if (l.recipientId !== viewerId) return null
          if (l.deliverAt > now) return null
          if (keepsakeRemovals.some((r) => r.userId === viewerId && r.letterId === l.id)) return null
          return {
            letter_id: l.id,
            correspondence_id: l.correspondenceId,
            delivered_at: l.deliverAt,
            reveal_line: lp.revealLine,
            back_message: lp.backMessage,
            sender_pseudonym_snapshot: lp.senderPseudonymSnapshot,
            postcard_key: v.postcardKey,
            title: v.title,
            location: v.location,
            collection: v.collection,
            postmark_text: v.postmarkText,
            footer_text: v.footerText,
            front_image_path: v.frontImagePath,
            motion_src: v.motionSrc ?? null,
            duration_seconds: v.durationSeconds ?? null,
            reveal_line_alignment: v.revealLineAlignment ?? null,
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.delivered_at.localeCompare(a.delivered_at))

      return { data: rows, error: null }
    }

    if (fn === 'remove_my_postcard') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }

      const letterId = params?.p_letter_id as string
      const exists = letterPostcards.some((lp) => {
        if (lp.letterId !== letterId) return false
        const l = letters.find((l) => l.id === letterId)
        return Boolean(l && l.recipientId === viewerId && l.deliverAt <= now)
      })
      if (!exists) return { data: null, error: { message: 'Postcard not found.', code: 'P0001' } }

      if (keepsakeRemovals.some((r) => r.userId === viewerId && r.letterId === letterId)) {
        return {
          data: null,
          error: { message: 'This Postcard has already been removed from your collection.', code: 'P0001' },
        }
      }

      keepsakeRemovals.push({ userId: viewerId, letterId })
      return { data: null, error: null }
    }

    throw new Error(`simulatePostcardRpcs: no rpc handler for "${fn}"`)
  }

  return {
    rpc,
    from(table: string) {
      if (table !== 'postcard_versions') throw new Error(`Unexpected table ${table}`)
      return {
        select() {
          return {
            async in(_column: string, ids: string[]) {
              return { data: versions.filter((v) => ids.includes(v.id)).map((v) => ({ id: v.id, story_text: v.storyText ?? '' })), error: null }
            },
          }
        },
      }
    },
    /** Test-only escape hatches. */
    _catalog: catalog,
    _versions: versions,
    _letterPostcards: letterPostcards,
    _keepsakeRemovals: keepsakeRemovals,
    _auditLog: auditLog,
    _setViewer(id: string | null) {
      viewerId = id
    },
  }
}
