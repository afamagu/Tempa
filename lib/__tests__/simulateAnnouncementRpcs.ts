// A validation-order simulation of the Announcements RPCs in
// docs/sql/2026-09-18-admin-operations-refinement.sql — same convention
// as simulateReportRpcs.ts: this proves the client-facing call shape
// and the documented validation ORDER, not live Postgres/RLS behavior
// itself (that migration is prepared but not executed).

export type FakeAnnouncement = {
  id: string
  title: string
  body: string
  status: 'draft' | 'published' | 'archived'
  starts_at: string | null
  ends_at: string | null
  created_at: string
  updated_at: string
}

export function createFakeAnnouncements(options: {
  viewerId: string | null
  announcements?: FakeAnnouncement[]
  staff?: Record<string, 'moderator' | 'admin'>
}) {
  let viewerId = options.viewerId
  const announcements = options.announcements ?? []
  const staff = options.staff ?? {}
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
      if (body.length === 0) return { data: null, error: { message: 'A body is required.', code: 'P0001' } }
      const startsAt = (params?.p_starts_at as string | null) ?? null
      const endsAt = (params?.p_ends_at as string | null) ?? null
      if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
        return { data: null, error: { message: 'The start time must be before the end time.', code: 'P0001' } }
      }
      const id = `announcement-${announcements.length + 1}`
      const now = new Date().toISOString()
      announcements.push({ id, title, body, status: 'draft', starts_at: startsAt, ends_at: endsAt, created_at: now, updated_at: now })
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
      if (body.length === 0) return { data: null, error: { message: 'A body is required.', code: 'P0001' } }
      const startsAt = (params?.p_starts_at as string | null) ?? null
      const endsAt = (params?.p_ends_at as string | null) ?? null
      if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
        return { data: null, error: { message: 'The start time must be before the end time.', code: 'P0001' } }
      }
      a.title = title
      a.body = body
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
      a.status = 'published'
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
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
      if (!active) return { data: [], error: null }
      return { data: [{ id: active.id, title: active.title, body: active.body }], error: null }
    }

    throw new Error(`simulateAnnouncementRpcs: no rpc handler for "${fn}"`)
  }

  return {
    rpc,
    _announcements: announcements,
    _auditLog: auditLog,
    _setViewer(id: string | null) {
      viewerId = id
    },
  }
}
