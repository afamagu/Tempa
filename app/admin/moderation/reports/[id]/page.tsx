import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getReport } from '@/lib/admin'
import { REPORT_REASONS } from '@/lib/reports'
import { formatDateTimeFull } from '@/lib/format-date'
import {
  sectionTitleClass,
  sectionLabelClass,
  helperTextClass,
  proseBodyClass,
  contextQuestionClass,
} from '@/app/profile/ui'
import MarkReviewedButton from '@/app/admin/mark-reviewed-button'
import ContentModerationActions from '@/app/admin/content-moderation-actions'

const REASON_LABELS = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]))

/**
 * Report detail — for private correspondence (a letter, or a photo
 * Moment that came from one), this shows ONLY the report-time evidence
 * snapshot the reporter's own report carried with it, never the
 * reported member's other letters or their mailbox generally. A
 * Dispatch/profile/published-answer/published-photo report shows the
 * same content any member could already see, since those were never
 * private to begin with.
 *
 * Admin Command Center Phase 2A-1 — moved here from app/admin/reports/
 * [id]/page.tsx as Reports became a child of Moderation (see
 * app/admin/moderation/layout.tsx). Two additions: a `question_answer`
 * evidence branch (prompt + body + author pseudonym snapshot, frozen at
 * report time — never the live row, which may have since changed), and
 * Hide/Restore content-moderation actions for the two target types that
 * now carry moderation state (dispatch, question_answer). Every other
 * target type (profile, letter, photo_moment) is completely unchanged —
 * account enforcement remains the only moderation lever for those.
 */
export default async function AdminReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: report } = await getReport(supabase, id)

  if (!report) {
    notFound()
  }

  const evidence = report.evidenceSnapshot as Record<string, unknown>

  let photoUrl: string | null = null
  if (report.targetType === 'photo_moment' && typeof evidence.image_path === 'string') {
    const bucket = evidence.source === 'dispatch' ? 'dispatch-photos' : 'letter-photos'
    const { data } = await supabase.storage.from(bucket).createSignedUrl(evidence.image_path, 600)
    photoUrl = data?.signedUrl ?? null
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/moderation/reports"
          className="text-[14px] text-foreground/70 transition-colors hover:text-foreground"
        >
          ← Report queue
        </Link>
      </div>

      <div className="space-y-1">
        <p className={sectionLabelClass}>{REASON_LABELS[report.reason] ?? report.reason}</p>
        <h1 className={sectionTitleClass}>Reported {report.targetType.replace('_', ' ')}</h1>
        <p className={helperTextClass}>{formatDateTimeFull(report.createdAt)}</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-1 rounded-md border border-foreground/10 p-3">
          <p className={sectionLabelClass}>Reported member</p>
          <p className="text-[15px] text-foreground">{report.reportedPseudonym}</p>
          <p className={helperTextClass}>Current status: {report.reportedCurrentStatus}</p>
          <Link
            href={`/admin/members/${report.reportedUserId}`}
            className="inline-block text-[14px] text-foreground/70 underline underline-offset-4 transition-colors hover:text-foreground"
          >
            View member
          </Link>
        </div>
        <div className="space-y-1 rounded-md border border-foreground/10 p-3">
          <p className={sectionLabelClass}>Reported by</p>
          <p className="text-[15px] text-foreground">{report.reporterPseudonym}</p>
        </div>
      </div>

      {report.context && (
        <div className="space-y-1">
          <p className={sectionLabelClass}>Reporter&rsquo;s explanation</p>
          <p className="text-[15px] text-foreground">{report.context}</p>
        </div>
      )}

      <div className="space-y-2">
        <p className={sectionLabelClass}>Evidence at time of report</p>
        <div className="rounded-md bg-surface-shell p-4">
          {report.targetType === 'photo_moment' ? (
            photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="Reported photo" className="max-h-96 rounded-md object-contain" />
            ) : (
              <p className={helperTextClass}>This photo could not be loaded.</p>
            )
          ) : report.targetType === 'profile' ? (
            <dl className="space-y-1 text-[14px] text-foreground">
              <div>Pseudonym: {String(evidence.pseudonym ?? '—')}</div>
              <div>Country: {String(evidence.country ?? '—')}</div>
            </dl>
          ) : report.targetType === 'question_answer' ? (
            <>
              <p className={contextQuestionClass}>{String(evidence.prompt ?? '')}</p>
              <p className={`mt-2 whitespace-pre-wrap ${proseBodyClass}`}>{String(evidence.body ?? '')}</p>
            </>
          ) : (
            <>
              {typeof evidence.title === 'string' && (
                <p className="text-[15px] font-medium text-foreground">{evidence.title}</p>
              )}
              <p className={`mt-2 whitespace-pre-wrap ${proseBodyClass}`}>{String(evidence.body ?? '')}</p>
            </>
          )}
        </div>
      </div>

      {(report.targetType === 'dispatch' || report.targetType === 'question_answer') &&
        report.targetModerationStatus && (
          <div className="space-y-2">
            <p className={sectionLabelClass}>Content moderation</p>
            <ContentModerationActions
              contentType={report.targetType}
              contentId={report.targetId}
              currentStatus={report.targetModerationStatus}
            />
          </div>
        )}

      <div className="flex items-center gap-3">
        <MarkReviewedButton reportId={report.id} alreadyReviewed={report.status === 'reviewed'} />
        {report.status === 'reviewed' && <p className={helperTextClass}>Reviewed</p>}
      </div>
    </div>
  )
}
