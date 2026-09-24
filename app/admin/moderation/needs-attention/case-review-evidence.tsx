import { formatDateTimeFull } from '@/lib/format-date'
import { sectionLabelClass, helperTextClass, metadataTextClass } from '@/app/profile/ui'
import type { CaseReview } from '@/lib/admin-safety'
import { reasonCodeLabel, riskBandLabel, surfaceLabel } from './reason-labels'

/**
 * Phase 1 — what a reviewer needs to actually decide: the account's
 * restriction state, the qualifying-attempt / distinct-recipient counts
 * behind the automatic rule, behavioural context, and the text of the
 * attempts themselves — including a blocked attempt that was never sent.
 *
 * Privacy boundary: this only renders what admin_get_safety_case_review
 * returned (one case id in, that member's own flagged attempts out).
 * Recipients appear only as "Person A/B/C" ordinals, so the reviewer can
 * see how many DIFFERENT people were involved without learning who they
 * are, and no other correspondence is ever loaded. Opening this page is
 * itself audited server-side (view_safety_attempt_evidence).
 */
export default function CaseReviewEvidence({ review }: { review: CaseReview }) {
  const { summary, attempts } = review

  return (
    <div className="space-y-4">
      {summary.restrictionPendingReview && (
        <div className="rounded-md border border-foreground/20 bg-foreground/[.04] p-3">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-foreground">Restricted — pending review</p>
          <p className={helperTextClass}>
            The system restricted this account{summary.statusChangedAt ? ` on ${formatDateTimeFull(summary.statusChangedAt)}` : ''} after
            qualifying financial-solicitation attempts involving {summary.distinctContexts72h} different people within 72 hours. The member can
            read but not write. Restoring, keeping the restriction, suspending or banning is your decision.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 rounded-md border border-foreground/10 p-3">
          <p className={sectionLabelClass}>Financial-solicitation attempts</p>
          <p className={helperTextClass}>
            {summary.qualifyingAttempts72h} qualifying attempt{summary.qualifyingAttempts72h === 1 ? '' : 's'} in the last 72 hours, involving{' '}
            {summary.distinctContexts72h} distinct recipient{summary.distinctContexts72h === 1 ? '' : 's'}
          </p>
          <p className={helperTextClass}>{summary.qualifyingAttemptsTotal} qualifying attempts in total</p>
          {summary.firstQualifyingAttemptAt && (
            <p className={helperTextClass}>
              First {formatDateTimeFull(summary.firstQualifyingAttemptAt)}
              {summary.lastQualifyingAttemptAt ? ` · latest ${formatDateTimeFull(summary.lastQualifyingAttemptAt)}` : ''}
            </p>
          )}
          <p className={helperTextClass}>
            Rewriting the same message to one person counts as one recipient. Only attempts that were blocked as financial solicitation count.
          </p>
        </div>

        <div className="space-y-1 rounded-md border border-foreground/10 p-3">
          <p className={sectionLabelClass}>Behavioural context</p>
          <p className={helperTextClass}>
            Account {summary.accountAgeDays === null ? 'age unknown' : `${summary.accountAgeDays} day${summary.accountAgeDays === 1 ? '' : 's'} old`}
            {summary.accountCreatedAt ? ` (created ${formatDateTimeFull(summary.accountCreatedAt)})` : ''}
          </p>
          <p className={helperTextClass}>
            {summary.firstContacts24h} first contact{summary.firstContacts24h === 1 ? '' : 's'} in 24 hours to {summary.distinctFirstContactRecipients24h}{' '}
            different {summary.distinctFirstContactRecipients24h === 1 ? 'person' : 'people'}
          </p>
          <p className={helperTextClass}>
            {summary.contactSharingEvaluations30d} message{summary.contactSharingEvaluations30d === 1 ? '' : 's'} with personal contact / off-platform
            sharing in 30 days (allowed; context only)
          </p>
          {Object.keys(summary.behavioralSignals30d).length > 0 && (
            <p className={helperTextClass}>
              Signals, 30 days:{' '}
              {Object.entries(summary.behavioralSignals30d)
                .map(([code, n]) => `${reasonCodeLabel(code)} × ${n}`)
                .join(', ')}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <p className={sectionLabelClass}>Flagged attempts ({attempts.length})</p>
        {attempts.length === 0 ? (
          <p className={helperTextClass}>No attempt text was recorded for this member.</p>
        ) : (
          attempts.map((a) => (
            <div key={a.evaluationId} className="space-y-2 rounded-md border border-foreground/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[15px] font-medium text-foreground">
                  {surfaceLabel(a.surface)} · {a.recipientOrdinal}
                </p>
                <p className={metadataTextClass}>{formatDateTimeFull(a.createdAt)}</p>
              </div>
              <p className={helperTextClass}>
                {a.sent ? 'Sent' : 'Blocked — never sent'} · {riskBandLabel(a.riskBand)}
                {a.qualifying ? ' · counted toward the automatic rule' : ''}
                {a.reasonCodes.length > 0 && ` · ${a.reasonCodes.map(reasonCodeLabel).join(', ')}`}
              </p>
              {a.attemptedTitle && <p className="text-[14px] font-medium text-foreground/90">{a.attemptedTitle}</p>}
              {a.attemptedBody && (
                <p className="whitespace-pre-wrap rounded bg-foreground/[.04] p-2 text-[14px] leading-relaxed text-foreground/90">{a.attemptedBody}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
