import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminError } from './admin'

/**
 * Admin Command Center Phase 1 — thin wrappers around the two new
 * staff-only aggregate RPCs (docs/sql/2026-09-10-admin-overview-
 * metrics.sql, prepared but not yet applied) plus the pure client-side
 * logic (windowing, spike detection, Needs Attention) that only needs
 * the already-fetched data, never a second round trip. Both RPCs check
 * is_staff() themselves, server-side — these wrappers are a call-shape
 * convenience only, same convention as lib/admin.ts.
 */

export type OverviewCounts = {
  totalMembers: number
  newMembersToday: number
  newMembers7d: number
  newMembers30d: number

  lettersSentToday: number
  lettersSent7d: number
  lettersSent30d: number
  lettersTravelling: number
  totalCorrespondences: number
  newCorrespondences7d: number
  firstLetters: number
  correspondences2Plus: number
  correspondences5Plus: number
  /** Labeled in the UI exactly as "Members who wrote in the last 7
   * days" — never presented as a generic "active members" claim. */
  membersWrote7d: number

  openReports: number
  reportsToday: number
  reviewedReportsTotal: number
  restrictedMembers: number
  suspendedMembers: number
  bannedMembers: number

  publishedDispatchesTotal: number
  publishedDispatches7d: number
  photoMomentsTotal: number
  photoMoments7d: number
  postcardsSentTotal: number
  postcardsSent7d: number
  livingPostcardsTotal: number
}

type OverviewCountsRow = {
  total_members: number
  new_members_today: number
  new_members_7d: number
  new_members_30d: number
  letters_sent_today: number
  letters_sent_7d: number
  letters_sent_30d: number
  letters_travelling: number
  total_correspondences: number
  new_correspondences_7d: number
  first_letters: number
  correspondences_2plus: number
  correspondences_5plus: number
  members_wrote_7d: number
  open_reports: number
  reports_today: number
  reviewed_reports_total: number
  restricted_members: number
  suspended_members: number
  banned_members: number
  published_dispatches_total: number
  published_dispatches_7d: number
  photo_moments_total: number
  photo_moments_7d: number
  postcards_sent_total: number
  postcards_sent_7d: number
  living_postcards_total: number
}

/** Pure: maps the RPC's raw snake_case row to the camelCase shape the
 * UI consumes — split out from getOverviewCounts so the mapping itself
 * is directly unit-testable without a Supabase client. */
export function mapOverviewCountsRow(row: OverviewCountsRow): OverviewCounts {
  return {
    totalMembers: row.total_members,
    newMembersToday: row.new_members_today,
    newMembers7d: row.new_members_7d,
    newMembers30d: row.new_members_30d,
    lettersSentToday: row.letters_sent_today,
    lettersSent7d: row.letters_sent_7d,
    lettersSent30d: row.letters_sent_30d,
    lettersTravelling: row.letters_travelling,
    totalCorrespondences: row.total_correspondences,
    newCorrespondences7d: row.new_correspondences_7d,
    firstLetters: row.first_letters,
    correspondences2Plus: row.correspondences_2plus,
    correspondences5Plus: row.correspondences_5plus,
    membersWrote7d: row.members_wrote_7d,
    openReports: row.open_reports,
    reportsToday: row.reports_today,
    reviewedReportsTotal: row.reviewed_reports_total,
    restrictedMembers: row.restricted_members,
    suspendedMembers: row.suspended_members,
    bannedMembers: row.banned_members,
    publishedDispatchesTotal: row.published_dispatches_total,
    publishedDispatches7d: row.published_dispatches_7d,
    photoMomentsTotal: row.photo_moments_total,
    photoMoments7d: row.photo_moments_7d,
    postcardsSentTotal: row.postcards_sent_total,
    postcardsSent7d: row.postcards_sent_7d,
    livingPostcardsTotal: row.living_postcards_total,
  }
}

export async function getOverviewCounts(
  supabase: SupabaseClient
): Promise<{ data: OverviewCounts | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_overview_counts')
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  const row = (Array.isArray(data) ? data[0] : data) as OverviewCountsRow | undefined
  if (!row) return { data: null, error: null }
  return { data: mapOverviewCountsRow(row), error: null }
}

export type DailySeriesPoint = {
  day: string
  newMembers: number
  lettersSent: number
  newCorrespondences: number
  reports: number
}

type DailySeriesRow = {
  day: string
  new_members: number
  letters_sent: number
  new_correspondences: number
  reports: number
}

export function mapDailySeriesRows(rows: DailySeriesRow[]): DailySeriesPoint[] {
  return rows.map((r) => ({
    day: r.day,
    newMembers: r.new_members,
    lettersSent: r.letters_sent,
    newCorrespondences: r.new_correspondences,
    reports: r.reports,
  }))
}

export async function getOverviewDailySeries(
  supabase: SupabaseClient,
  days: number = 30
): Promise<{ data: DailySeriesPoint[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_overview_daily_series', { p_days: days })
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  return { data: mapDailySeriesRows((data ?? []) as DailySeriesRow[]), error: null }
}

// ============================================================
// PURE CLIENT-SIDE LOGIC — windowing, spike detection, Needs
// Attention. Operates entirely on already-fetched data; never a
// second RPC round trip.
// ============================================================

export type SeriesMetricKey = 'newMembers' | 'lettersSent' | 'newCorrespondences' | 'reports'

/** Pure: the last `days` points of an ascending (oldest-first), already-
 * fetched series — the 7-day/30-day chart toggle operates on one fetch. */
export function windowSeries(series: DailySeriesPoint[], days: number): DailySeriesPoint[] {
  if (days >= series.length) return series
  return series.slice(series.length - days)
}

/** Pure: mean of a metric across the up-to-7 days immediately BEFORE
 * the series' own last point (today) — the trailing baseline a spike
 * is judged against. Today itself is deliberately excluded, so a
 * genuine spike can't quietly inflate its own baseline. Returns 0 when
 * there's no trailing window at all (e.g. a 1-day series). */
export function trailingAverage(series: DailySeriesPoint[], metric: SeriesMetricKey): number {
  const trailing = series.slice(0, -1).slice(-7)
  if (trailing.length === 0) return 0
  const sum = trailing.reduce((total, point) => total + point[metric], 0)
  return sum / trailing.length
}

const SPIKE_MULTIPLIER = 2
const SPIKE_FLOOR = 3

export type SpikeResult = { isSpike: boolean; today: number; trailingAverage: number }

/** Pure: a simple, transparent spike rule — today counts as unusual
 * only when it's BOTH at least SPIKE_MULTIPLIER× the trailing 7-day
 * average AND at least SPIKE_FLOOR in absolute terms, so a quiet
 * baseline (e.g. 0.2/day) can't call one ordinary signup a "spike." */
export function detectSpike(series: DailySeriesPoint[], metric: SeriesMetricKey): SpikeResult {
  if (series.length === 0) return { isSpike: false, today: 0, trailingAverage: 0 }
  const today = series[series.length - 1][metric]
  const avg = trailingAverage(series, metric)
  return { isSpike: today >= SPIKE_FLOOR && today >= avg * SPIKE_MULTIPLIER, today, trailingAverage: avg }
}

export type AttentionItem = {
  key: string
  label: string
  detail: string
  href?: string
}

/** Pure: builds the restrained Needs Attention list from already-
 * computed inputs — returns [] when nothing needs a look, which the
 * UI renders as "No immediate issues." rather than a fake green
 * indicator for anything not actually observed. */
export function buildAttentionItems(input: {
  openReports: number
  restrictedMembers: number
  suspendedMembers: number
  bannedMembers: number
  signupSpike: SpikeResult
  reportSpike: SpikeResult
}): AttentionItem[] {
  const items: AttentionItem[] = []

  if (input.openReports > 0) {
    items.push({
      key: 'open-reports',
      label: `${input.openReports} open report${input.openReports === 1 ? '' : 's'}`,
      detail: 'Awaiting review.',
      href: '/admin/moderation/reports',
    })
  }

  if (input.reportSpike.isSpike) {
    items.push({
      key: 'report-spike',
      label: 'Unusual report volume today',
      detail: `${input.reportSpike.today} today vs. a ${input.reportSpike.trailingAverage.toFixed(1)}/day trailing average.`,
      href: '/admin/moderation/reports',
    })
  }

  if (input.signupSpike.isSpike) {
    items.push({
      key: 'signup-spike',
      label: 'Unusual signup volume today',
      detail: `${input.signupSpike.today} today vs. a ${input.signupSpike.trailingAverage.toFixed(1)}/day trailing average.`,
    })
  }

  if (input.bannedMembers > 0) {
    items.push({
      key: 'banned-members',
      label: `${input.bannedMembers} banned member${input.bannedMembers === 1 ? '' : 's'}`,
      detail: 'Currently enforced.',
      href: '/admin/members',
    })
  }

  if (input.suspendedMembers > 0) {
    items.push({
      key: 'suspended-members',
      label: `${input.suspendedMembers} suspended member${input.suspendedMembers === 1 ? '' : 's'}`,
      detail: 'Currently enforced.',
      href: '/admin/members',
    })
  }

  if (input.restrictedMembers > 0) {
    items.push({
      key: 'restricted-members',
      label: `${input.restrictedMembers} restricted member${input.restrictedMembers === 1 ? '' : 's'}`,
      detail: 'Currently enforced.',
      href: '/admin/members',
    })
  }

  return items
}
