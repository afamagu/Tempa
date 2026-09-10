// A validation-order simulation of the two Admin Command Center Phase 1
// aggregate RPCs in docs/sql/2026-09-10-admin-overview-metrics.sql —
// same convention as simulateReportRpcs.ts: this proves the client-
// facing call shape and the documented COUNTING LOGIC (first-letter
// definition, travelling = deliver_at > now(), day-bucketing, etc.),
// not live Postgres/RLS behavior itself (that migration is prepared but
// not executed). The SQL migration text is the actual authority for
// exact wording/behavior.

export type FakeAuthUser = { id: string; created_at: string }
export type FakeProfile = { id: string }
export type FakeLetter = {
  id: string
  sender_id: string
  correspondence_id: string
  reply_to_id: string | null
  question_answer_id: string | null
  created_at: string
  deliver_at: string
}
export type FakeCorrespondence = { id: string; created_at: string }
export type FakeReport = { status: 'open' | 'reviewed'; created_at: string }
export type FakeAccountStatusRow = { user_id: string; status: 'active' | 'restricted' | 'suspended' | 'banned' }
export type FakeDispatch = { status: 'published' | 'unpublished'; published_at: string }
export type FakeMoment = { type: 'photo' | 'postcard'; created_at: string }
// dispatch_moments carries no `type` column — every row in it IS a
// photo (Dispatches have no Postcard entry point).
export type FakeDispatchMoment = { created_at: string }
export type FakePostcardVersion = { id: string; motion_src: string | null }
export type FakeLetterPostcard = { created_at: string; postcard_version_id: string }

function dayOf(iso: string): string {
  return iso.slice(0, 10)
}

export function createFakeAdminOverview(options: {
  viewerId: string | null
  staff?: Record<string, 'moderator' | 'admin'>
  now?: Date
  authUsers?: FakeAuthUser[]
  profiles?: FakeProfile[]
  letters?: FakeLetter[]
  correspondences?: FakeCorrespondence[]
  reports?: FakeReport[]
  accountStatus?: FakeAccountStatusRow[]
  dispatches?: FakeDispatch[]
  moments?: FakeMoment[]
  dispatchMoments?: FakeDispatchMoment[]
  postcardVersions?: FakePostcardVersion[]
  letterPostcards?: FakeLetterPostcard[]
}) {
  const viewerId = options.viewerId
  const staff = options.staff ?? {}
  const now = options.now ?? new Date()
  const authUsers = options.authUsers ?? []
  const profiles = options.profiles ?? []
  const letters = options.letters ?? []
  const correspondences = options.correspondences ?? []
  const reports = options.reports ?? []
  const accountStatus = options.accountStatus ?? []
  const dispatches = options.dispatches ?? []
  const moments = options.moments ?? []
  const dispatchMoments = options.dispatchMoments ?? []
  const postcardVersions = options.postcardVersions ?? []
  const letterPostcards = options.letterPostcards ?? []

  function isStaff(callerId: string | null) {
    if (!callerId) return false
    return Boolean(staff[callerId])
  }

  function since(iso: string, cutoff: Date) {
    return new Date(iso).getTime() >= cutoff.getTime()
  }

  async function rpc(fn: string, params?: Record<string, unknown>) {
    if (fn === 'admin_overview_counts') {
      if (!isStaff(viewerId)) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }

      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      const d7 = new Date(now.getTime() - 7 * 86_400_000)
      const d30 = new Date(now.getTime() - 30 * 86_400_000)

      const authById = new Map(authUsers.map((u) => [u.id, u]))

      const correspondenceLetterCounts = new Map<string, number>()
      for (const l of letters) {
        correspondenceLetterCounts.set(l.correspondence_id, (correspondenceLetterCounts.get(l.correspondence_id) ?? 0) + 1)
      }

      const row = {
        total_members: profiles.length,
        new_members_today: profiles.filter((p) => authById.has(p.id) && since(authById.get(p.id)!.created_at, todayStart)).length,
        new_members_7d: profiles.filter((p) => authById.has(p.id) && since(authById.get(p.id)!.created_at, d7)).length,
        new_members_30d: profiles.filter((p) => authById.has(p.id) && since(authById.get(p.id)!.created_at, d30)).length,

        letters_sent_today: letters.filter((l) => since(l.created_at, todayStart)).length,
        letters_sent_7d: letters.filter((l) => since(l.created_at, d7)).length,
        letters_sent_30d: letters.filter((l) => since(l.created_at, d30)).length,
        letters_travelling: letters.filter((l) => new Date(l.deliver_at).getTime() > now.getTime()).length,
        total_correspondences: correspondences.length,
        new_correspondences_7d: correspondences.filter((c) => since(c.created_at, d7)).length,
        // Locked definition — never bare reply_to_id is null.
        first_letters: letters.filter((l) => l.reply_to_id === null && l.question_answer_id !== null).length,
        correspondences_2plus: [...correspondenceLetterCounts.values()].filter((n) => n >= 2).length,
        correspondences_5plus: [...correspondenceLetterCounts.values()].filter((n) => n >= 5).length,
        members_wrote_7d: new Set(letters.filter((l) => since(l.created_at, d7)).map((l) => l.sender_id)).size,

        open_reports: reports.filter((r) => r.status === 'open').length,
        reports_today: reports.filter((r) => since(r.created_at, todayStart)).length,
        reviewed_reports_total: reports.filter((r) => r.status === 'reviewed').length,
        restricted_members: accountStatus.filter((a) => a.status === 'restricted').length,
        suspended_members: accountStatus.filter((a) => a.status === 'suspended').length,
        banned_members: accountStatus.filter((a) => a.status === 'banned').length,

        published_dispatches_total: dispatches.filter((d) => d.status === 'published').length,
        published_dispatches_7d: dispatches.filter((d) => d.status === 'published' && since(d.published_at, d7)).length,
        // Photo Moments across ALL of TEMPA — letters + Dispatches.
        // Never a historical Postcard Moment (moments.type='postcard').
        photo_moments_total:
          moments.filter((m) => m.type === 'photo').length + dispatchMoments.length,
        photo_moments_7d:
          moments.filter((m) => m.type === 'photo' && since(m.created_at, d7)).length +
          dispatchMoments.filter((dm) => since(dm.created_at, d7)).length,
        postcards_sent_total: letterPostcards.length,
        postcards_sent_7d: letterPostcards.filter((lp) => since(lp.created_at, d7)).length,
        living_postcards_total: letterPostcards.filter((lp) => {
          const v = postcardVersions.find((pv) => pv.id === lp.postcard_version_id)
          return v?.motion_src != null
        }).length,
      }

      return { data: [row], error: null }
    }

    if (fn === 'admin_overview_daily_series') {
      if (!isStaff(viewerId)) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }

      const days = Math.min(Math.max(Number((params?.p_days as number | undefined) ?? 30), 1), 90)
      const authById = new Map(authUsers.map((u) => [u.id, u]))
      const memberSignupDays = profiles
        .filter((p) => authById.has(p.id))
        .map((p) => dayOf(authById.get(p.id)!.created_at))

      const rows: {
        day: string
        new_members: number
        letters_sent: number
        new_correspondences: number
        reports: number
      }[] = []

      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - i * 86_400_000)
        const dayStr = dayOf(d.toISOString())
        rows.push({
          day: dayStr,
          new_members: memberSignupDays.filter((day) => day === dayStr).length,
          letters_sent: letters.filter((l) => dayOf(l.created_at) === dayStr).length,
          new_correspondences: correspondences.filter((c) => dayOf(c.created_at) === dayStr).length,
          reports: reports.filter((r) => dayOf(r.created_at) === dayStr).length,
        })
      }

      return { data: rows, error: null }
    }

    throw new Error(`simulateAdminOverviewRpc: no rpc handler for "${fn}"`)
  }

  return { rpc }
}
