// A validation-order simulation of the Announcements RPCs in
// docs/sql/2026-09-18-admin-operations-refinement.sql (V1) and
// docs/sql/2026-09-19-question-slots-and-premium-announcements.sql
// (Premium Announcement Publishing — subtitle/content_json/
// hero_image_path/published_at, the publish-requirements guard, and
// the Final Correction round's server-side content/link validation,
// permissive Draft body, and hero-image existence check). Same
// convention as simulateReportRpcs.ts: this proves the client-facing
// call shape and the documented validation ORDER, not live
// Postgres/RLS behavior itself.

import { isAnnouncementHrefSafe } from '../announcement-link-safety'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function hasOnlyKeys(obj: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(obj).every((k) => allowed.includes(k))
}

// Mirrors public.announcement_node_is_valid exactly (same p_kind
// dispatch, same closed shape) — a pure-JS re-implementation of the
// SQL validator so tests can prove the boundary rejects malformed/
// adversarial content_json without hitting real Postgres.
function validNode(node: unknown, kind: string, depth: number): boolean {
  if (depth > 12) return false
  if (!isPlainObject(node)) return false
  const type = node.type

  if (kind === 'doc') {
    if (type !== 'doc') return false
    if (!hasOnlyKeys(node, ['type', 'content'])) return false
    if ('content' in node) {
      if (!Array.isArray(node.content)) return false
      return node.content.every((c) => validNode(c, 'block', depth + 1))
    }
    return true
  }

  if (kind === 'block') {
    if (type === 'paragraph') {
      if (!hasOnlyKeys(node, ['type', 'content'])) return false
      if ('content' in node) {
        if (!Array.isArray(node.content)) return false
        return node.content.every((c) => validNode(c, 'inline', depth + 1))
      }
      return true
    }
    if (type === 'heading') {
      if (!hasOnlyKeys(node, ['type', 'attrs', 'content'])) return false
      if (!isPlainObject(node.attrs) || !hasOnlyKeys(node.attrs, ['level'])) return false
      if (node.attrs.level !== 2) return false
      if ('content' in node) {
        if (!Array.isArray(node.content)) return false
        return node.content.every((c) => validNode(c, 'inline', depth + 1))
      }
      return true
    }
    if (type === 'bulletList') {
      if (!hasOnlyKeys(node, ['type', 'content'])) return false
      if ('content' in node) {
        if (!Array.isArray(node.content)) return false
        return node.content.every((c) => validNode(c, 'listItem', depth + 1))
      }
      return true
    }
    return false
  }

  if (kind === 'listItem') {
    if (type !== 'listItem') return false
    if (!hasOnlyKeys(node, ['type', 'content'])) return false
    if ('content' in node) {
      if (!Array.isArray(node.content)) return false
      return node.content.every((c) => validNode(c, 'listItemParagraph', depth + 1))
    }
    return true
  }

  if (kind === 'listItemParagraph') {
    if (type !== 'paragraph') return false
    return validNode(node, 'block', depth)
  }

  if (kind === 'inline') {
    if (type === 'text') {
      if (!hasOnlyKeys(node, ['type', 'text', 'marks'])) return false
      if (typeof node.text !== 'string') return false
      if ('marks' in node) {
        if (!Array.isArray(node.marks)) return false
        for (const mark of node.marks) {
          if (!isPlainObject(mark)) return false
          if (mark.type === 'bold' || mark.type === 'italic') {
            if (!hasOnlyKeys(mark, ['type'])) return false
          } else if (mark.type === 'link') {
            if (!hasOnlyKeys(mark, ['type', 'attrs'])) return false
            if (!isPlainObject(mark.attrs) || !hasOnlyKeys(mark.attrs, ['href'])) return false
            if (typeof mark.attrs.href !== 'string') return false
            if (!isAnnouncementHrefSafe(mark.attrs.href)) return false
          } else {
            return false
          }
        }
      }
      return true
    }
    if (type === 'hardBreak') {
      return hasOnlyKeys(node, ['type'])
    }
    return false
  }

  return false
}

/** Mirrors public.announcement_content_is_valid. Exported for direct
 * regression coverage of the validator itself, independent of any one
 * RPC's call shape. */
export function simulatedContentJsonIsValid(doc: unknown): boolean {
  if (!isPlainObject(doc)) return false
  return validNode(doc, 'doc', 0)
}

/** Mirrors public.announcement_content_has_text (SQL Hardening round,
 * item 2) — deliberately generic, same as its SQL twin: it only walks
 * 'content' arrays looking for a 'text' node whose text is non-blank
 * after trimming, without re-deriving the full node/mark type-checking
 * simulatedContentJsonIsValid already does. hardBreak nodes and empty/
 * whitespace-only text correctly contribute nothing. */
function nodeHasText(node: unknown, depth: number): boolean {
  if (depth > 12) return false
  if (!isPlainObject(node)) return false
  if (node.type === 'text') {
    return typeof node.text === 'string' && node.text.trim().length > 0
  }
  if ('content' in node && Array.isArray(node.content)) {
    return node.content.some((c) => nodeHasText(c, depth + 1))
  }
  return false
}

export function simulatedContentHasText(doc: unknown): boolean {
  return nodeHasText(doc, 0)
}

export type FakeAnnouncement = {
  id: string
  title: string
  subtitle: string | null
  body: string
  content_json: Record<string, unknown> | null
  hero_image_path: string | null
  status: 'draft' | 'published' | 'archived'
  starts_at: string | null
  ends_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

export function createFakeAnnouncements(options: {
  viewerId: string | null
  announcements?: FakeAnnouncement[]
  staff?: Record<string, 'moderator' | 'admin'>
  /** Final Correction round, item 5 — an opt-in denylist simulating a
   * hero_image_path that does NOT actually exist in storage.objects.
   * Defaults to empty (every path "exists") so every pre-existing test
   * that sets heroImagePath to an arbitrary string without going
   * through the real upload mock keeps passing unchanged; a test
   * proving the existence check works opts a specific path in. */
  missingHeroImagePaths?: string[]
}) {
  let viewerId = options.viewerId
  const announcements = options.announcements ?? []
  const staff = options.staff ?? {}
  const missingHeroImagePaths = new Set(options.missingHeroImagePaths ?? [])
  const auditLog: { action: string; target_id: string }[] = []

  function isStaff(callerId: string | null, minRole: 'moderator' | 'admin' = 'moderator') {
    if (!callerId) return false
    const role = staff[callerId]
    if (!role) return false
    if (minRole === 'moderator') return true
    return role === 'admin'
  }

  function isCurrentlyActive(a: FakeAnnouncement, now: Date) {
    if (a.status !== 'published') return false
    if (a.starts_at && new Date(a.starts_at) > now) return false
    if (a.ends_at && new Date(a.ends_at) < now) return false
    return true
  }

  async function rpc(fn: string, params?: Record<string, unknown>) {
    if (fn === 'admin_list_announcements') {
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      return {
        data: announcements
          .slice()
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((a) => ({ ...a })),
        error: null,
      }
    }

    if (fn === 'admin_create_announcement') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const title = ((params?.p_title as string) ?? '').trim()
      const body = ((params?.p_body as string) ?? '').trim()
      if (title.length === 0) return { data: null, error: { message: 'A title is required.', code: 'P0001' } }
      // Final Correction round, item 4: a Draft may be created with a
      // blank body — only Publish requires real content (checked
      // below). No more unconditional "A body is required." rejection
      // here.
      const startsAt = (params?.p_starts_at as string | null) ?? null
      const endsAt = (params?.p_ends_at as string | null) ?? null
      if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
        return { data: null, error: { message: 'The start time must be before the end time.', code: 'P0001' } }
      }
      // Final Correction round, item 1: the same structural validator
      // as admin_content_json_valid — a direct RPC call bypassing the
      // TipTap editor's own client-side checks is still rejected.
      if (params?.p_content_json !== undefined && params?.p_content_json !== null) {
        if (!simulatedContentJsonIsValid(params.p_content_json)) {
          return { data: null, error: { message: 'The announcement body contains unsupported content.', code: 'P0001' } }
        }
      }
      const id = `announcement-${announcements.length + 1}`
      const now = new Date().toISOString()
      announcements.push({
        id,
        title,
        subtitle: (params?.p_subtitle as string | null) ?? null,
        body,
        content_json: (params?.p_content_json as Record<string, unknown> | null) ?? null,
        hero_image_path: (params?.p_hero_image_path as string | null) ?? null,
        status: 'draft',
        starts_at: startsAt,
        ends_at: endsAt,
        published_at: null,
        created_at: now,
        updated_at: now,
      })
      auditLog.push({ action: 'announcement_created', target_id: id })
      return { data: id, error: null }
    }

    if (fn === 'admin_update_announcement') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const a = announcements.find((a) => a.id === (params?.p_announcement_id as string))
      if (!a) return { data: null, error: { message: 'Announcement not found.', code: 'P0001' } }
      const title = ((params?.p_title as string) ?? '').trim()
      const body = ((params?.p_body as string) ?? '').trim()
      if (title.length === 0) return { data: null, error: { message: 'A title is required.', code: 'P0001' } }
      // Final Correction round, item 4: a live Announcement cannot be
      // edited down to a blank body; a Draft can.
      if (a.status === 'published' && body.length === 0) {
        return {
          data: null,
          error: {
            message: 'A live announcement cannot be edited down to a blank body. Deactivate it first if you need to.',
            code: 'P0001',
          },
        }
      }
      const startsAt = (params?.p_starts_at as string | null) ?? null
      const endsAt = (params?.p_ends_at as string | null) ?? null
      if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
        return { data: null, error: { message: 'The start time must be before the end time.', code: 'P0001' } }
      }
      // Final Correction round, item 1: same structural validator as
      // admin_create_announcement above.
      if (params?.p_content_json !== undefined && params?.p_content_json !== null) {
        if (!simulatedContentJsonIsValid(params.p_content_json)) {
          return { data: null, error: { message: 'The announcement body contains unsupported content.', code: 'P0001' } }
        }
      }
      a.title = title
      a.body = body
      a.subtitle = (params?.p_subtitle as string | null) ?? null
      if (params?.p_content_json !== undefined && params?.p_content_json !== null) {
        a.content_json = params.p_content_json as Record<string, unknown>
      }
      if (params?.p_hero_image_path !== undefined && params?.p_hero_image_path !== null) {
        a.hero_image_path = params.p_hero_image_path as string
      }
      a.starts_at = startsAt
      a.ends_at = endsAt
      a.updated_at = new Date().toISOString()
      auditLog.push({ action: 'announcement_updated', target_id: a.id })
      return { data: null, error: null }
    }

    if (fn === 'admin_publish_announcement') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const a = announcements.find((a) => a.id === (params?.p_announcement_id as string))
      if (!a) return { data: null, error: { message: 'Announcement not found.', code: 'P0001' } }
      if (a.status === 'published') {
        return { data: null, error: { message: 'This announcement is already published.', code: 'P0001' } }
      }
      if (!a.hero_image_path) {
        return { data: null, error: { message: 'A hero image is required before publishing.', code: 'P0001' } }
      }
      // Final Correction round, item 5: the hero image must actually
      // exist in storage, not just have a non-null path.
      if (missingHeroImagePaths.has(a.hero_image_path)) {
        return {
          data: null,
          error: { message: 'The hero image could not be found in storage. Please re-upload it.', code: 'P0001' },
        }
      }
      if (!a.ends_at) {
        return { data: null, error: { message: 'An end date and time is required before publishing.', code: 'P0001' } }
      }
      if (!a.content_json) {
        return { data: null, error: { message: 'A body is required before publishing.', code: 'P0001' } }
      }
      // SQL Hardening round, item 2: content_json itself (not merely
      // the separate body column) must be both structurally valid and
      // contain real text — closes the gap where a direct RPC call
      // could pair a valid-but-empty content_json with an unrelated
      // non-blank body.
      if (!simulatedContentJsonIsValid(a.content_json)) {
        return { data: null, error: { message: 'The announcement body contains unsupported content.', code: 'P0001' } }
      }
      if (!simulatedContentHasText(a.content_json)) {
        return { data: null, error: { message: 'A body is required before publishing.', code: 'P0001' } }
      }
      // Final Correction round, item 4: body is the derived plain-text
      // fallback, kept in sync on every write — an ADDITIONAL backstop
      // now, not the sole proof of real content.
      if (!a.body || a.body.trim().length === 0) {
        return { data: null, error: { message: 'A body is required before publishing.', code: 'P0001' } }
      }
      a.status = 'published'
      a.published_at = new Date().toISOString()
      a.updated_at = new Date().toISOString()
      auditLog.push({ action: 'announcement_published', target_id: a.id })
      return { data: null, error: null }
    }

    if (fn === 'admin_archive_announcement') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const a = announcements.find((a) => a.id === (params?.p_announcement_id as string))
      if (!a) return { data: null, error: { message: 'Announcement not found.', code: 'P0001' } }
      if (a.status !== 'published') {
        return { data: null, error: { message: 'This announcement is not currently published.', code: 'P0001' } }
      }
      a.status = 'archived'
      a.updated_at = new Date().toISOString()
      auditLog.push({ action: 'announcement_archived', target_id: a.id })
      return { data: null, error: null }
    }

    if (fn === 'get_active_announcement') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      const now = new Date()
      const active = announcements
        .filter((a) => isCurrentlyActive(a, now))
        .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))[0]
      if (!active) return { data: [], error: null }
      return {
        data: [
          {
            id: active.id,
            title: active.title,
            subtitle: active.subtitle,
            body: active.body,
            content_json: active.content_json,
            hero_image_path: active.hero_image_path,
          },
        ],
        error: null,
      }
    }

    throw new Error(`simulateAnnouncementRpcs: no rpc handler for "${fn}"`)
  }

  return {
    rpc,
    storage: {
      from() {
        return {
          async upload() {
            return { error: null }
          },
          async createSignedUrl(path: string) {
            return { data: { signedUrl: `https://signed.example/${path}` }, error: null }
          },
        }
      },
    },
    auth: {
      async getUser() {
        return { data: { user: viewerId ? { id: viewerId } : null } }
      },
    },
    _announcements: announcements,
    _auditLog: auditLog,
    _setViewer(id: string | null) {
      viewerId = id
    },
  }
}
