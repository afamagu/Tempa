import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listReports } from '@/lib/admin'
import { REPORT_REASONS } from '@/lib/reports'
import { formatDateTimeFull } from '@/lib/format-date'
import { sectionTitleClass, helperTextClass, metadataTextClass } from '@/app/profile/ui'

const REASON_LABELS = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]))

const TARGET_TYPE_LABELS: Record<string, string> = {
  profile: 'Profile',
  letter: 'Letter',
  dispatch: 'Dispatch',
  photo_moment: 'Photo',
  question_answer: 'Answer',
}

/**
 * Admin report queue — newest first, everything the checkpoint's own
 * "Minimum admin-side build" asks for and nothing else: no analytics,
 * no assignment, no case-management workflow. Clicking a row opens its
 * detail (app/admin/moderation/reports/[id]/page.tsx).
 *
 * Admin Command Center Phase 2A-1 — moved here from app/admin/reports/
 * page.tsx (itself moved here from the original app/admin/page.tsx in
 * Phase 1) as Reports became a child of the new Moderation nav
 * grouping — see app/admin/moderation/layout.tsx. The old /admin/reports
 * path now redirects here (next.config.ts).
 */
export default async function AdminReportsPage() {
  const supabase = await createClient()
  const { data: reports } = await listReports(supabase)

  return (
    <div className="space-y-6">
      <h1 className={sectionTitleClass}>Report queue</h1>

      {reports.length === 0 ? (
        <p className={helperTextClass}>No reports yet.</p>
      ) : (
        <div className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
          {reports.map((r) => (
            <Link
              key={r.id}
              href={`/admin/moderation/reports/${r.id}`}
              className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-foreground/[.03] sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium text-foreground">
                  {TARGET_TYPE_LABELS[r.targetType] ?? r.targetType} · {REASON_LABELS[r.reason] ?? r.reason}
                </p>
                <p className={metadataTextClass}>
                  {r.reportedPseudonym} reported by {r.reporterPseudonym}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {r.status === 'open' && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[12px] font-medium text-accent">
                    Open
                  </span>
                )}
                <span className={`whitespace-nowrap ${metadataTextClass}`}>{formatDateTimeFull(r.createdAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
