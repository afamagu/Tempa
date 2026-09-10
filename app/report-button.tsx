'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { reportContent, REPORT_REASONS, REPORT_CONTEXT_MAX_LENGTH, type ReportReason, type ReportTargetType } from '@/lib/reports'
import { helperTextClass, secondaryButtonClass, destructiveButtonClass, inputClass, fieldLabelClass } from '@/app/profile/ui'

/**
 * The one shared member-reporting control — Report → choose a reason →
 * optional "Tell us what happened" → Submit, reused verbatim on a
 * letter, a Dispatch, a photo Moment, and a profile (pre-beta minimum
 * safety build). All authorization, validation, evidence-snapshotting,
 * self-report/duplicate rejection happens server-side in report_content
 * (docs/sql/2026-09-17-reporting-and-admin-moderation.sql) — this
 * component exists only for a restrained, honest, identical presentation
 * everywhere it appears, never as the authorization boundary. Renders
 * its own inline choice (the established pattern — see BlockButton),
 * never a native window.confirm() or a separate route/modal.
 *
 * Deliberately does not expose a report number, queue position, or any
 * promise about outcome — only the quiet confirmation the checkpoint
 * specifies. Reporting never triggers a block and is never combined with
 * one; blocking remains a fully separate action a member chooses on
 * their own (BlockButton), matching report_content's own independence
 * from blocked_users.
 */
export default function ReportButton({
  targetType,
  targetId,
  triggerClassName,
  triggerLabel = 'Report',
  triggerAriaLabel,
  panelClassName = '',
}: {
  targetType: ReportTargetType
  targetId: string
  triggerClassName: string
  triggerLabel?: React.ReactNode
  /** Set when triggerLabel is icon-only content rather than the text "Report". */
  triggerAriaLabel?: string
  /** Applied to the expanded reason-picker/confirmation panel only — the
   * collapsed trigger is unaffected. Leave unset for an inline call site
   * (a dropdown/menu that already positions itself); pass a `position:
   * absolute` popover shell for a call site that needs one (e.g. an icon
   * trigger sitting in a flex row of other icon buttons). */
  panelClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [context, setContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  function reset() {
    setOpen(false)
    setReason(null)
    setContext('')
    setError(null)
    setBusy(false)
    setSubmitted(false)
  }

  async function handleSubmit() {
    if (busy || !reason) return
    setBusy(true)
    setError(null)

    const { error: reportError } = await reportContent(createClient(), targetType, targetId, reason, context)

    setBusy(false)

    if (reportError) {
      setError(
        reportError.message === 'You have already reported this.'
          ? 'You have already reported this.'
          : 'Could not send this report. Please try again.'
      )
      return
    }

    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className={panelClassName}>
        <p className={helperTextClass}>Report received. Thank you for letting us know.</p>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={triggerAriaLabel}
        className={triggerClassName}
      >
        {triggerLabel}
      </button>
    )
  }

  return (
    <div className={`space-y-3 ${panelClassName}`}>
      <div>
        <p className={fieldLabelClass}>What&rsquo;s wrong?</p>
        <div className="mt-2 space-y-1.5">
          {REPORT_REASONS.map((r) => (
            <label key={r.value} className="flex items-center gap-2 text-[14px] text-foreground">
              <input
                type="radio"
                name={`report-reason-${targetType}-${targetId}`}
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
              />
              {r.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className={fieldLabelClass} htmlFor={`report-context-${targetType}-${targetId}`}>
          Tell us what happened (optional)
        </label>
        <textarea
          id={`report-context-${targetType}-${targetId}`}
          value={context}
          onChange={(e) => setContext(e.target.value.slice(0, REPORT_CONTEXT_MAX_LENGTH))}
          maxLength={REPORT_CONTEXT_MAX_LENGTH}
          rows={3}
          className={`mt-2 ${inputClass}`}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={reset} disabled={busy} className={secondaryButtonClass}>
          Cancel
        </button>
        <button type="button" onClick={handleSubmit} disabled={busy || !reason} className={destructiveButtonClass}>
          {busy ? 'Sending…' : 'Submit report'}
        </button>
      </div>
    </div>
  )
}
