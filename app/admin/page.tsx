import { createClient } from '@/lib/supabase/server'
import { getOverviewCounts, getOverviewDailySeries } from '@/lib/admin-overview'
import AdminOverview from './overview-client'

/**
 * Admin Command Center Phase 1 — the /admin landing page. Server-
 * fetches the first paint's worth of data (both staff-only aggregate
 * RPCs, docs/sql/2026-09-10-admin-overview-metrics.sql, live in
 * production) so there's no loading flash on open; AdminOverview
 * (client) owns the 45s periodic refresh from there.
 *
 * The report queue that used to live at this exact route moved to
 * /admin/reports in Phase 1, then to /admin/moderation/reports in
 * Phase 2A-1 as Reports became a child of the new Moderation nav
 * grouping — see that route's own doc comment. Both old paths redirect
 * (next.config.ts).
 */
export default async function AdminOverviewPage() {
  const supabase = await createClient()

  const [countsResult, seriesResult] = await Promise.all([
    getOverviewCounts(supabase),
    getOverviewDailySeries(supabase, 30),
  ])

  return (
    <AdminOverview
      initialCounts={countsResult.data}
      initialSeries={seriesResult.data}
      initialError={countsResult.error?.message ?? seriesResult.error?.message ?? null}
    />
  )
}
