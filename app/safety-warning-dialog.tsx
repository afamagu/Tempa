'use client'

import { useEffect } from 'react'
import { primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'
import {
  SAFETY_WARNING_TITLE,
  SAFETY_WARNING_BODY,
  SAFETY_NOTE_TITLE,
  SAFETY_CONTACT_BODY,
  SAFETY_CONTACT_REVIEW_ACTION,
  SAFETY_CONTACT_SEND_ACTION,
  SAFETY_CONTACT_SHARING_COPY_KEY,
} from '@/lib/safety/send-with-safety'

/**
 * Safety 2, Checkpoint 3 — the one calm pre-send interruption shared by
 * every Letter composer (never a per-composer reimplementation). Shown
 * only for a `warning_required` disposition; a `cannot_send` disposition
 * never reaches this component at all — that gets restrained inline
 * blocking copy with no bypass, directly in the composer's own error
 * area, matching every other send-failure message already there.
 *
 * Never a "proof of guilt" framing — no mention of scams, fraud, risk
 * bands, or reason codes (see lib/safety/send-with-safety.ts's own
 * shared copy constants). The member can always go back and edit
 * (onCancel — closes this dialog, the draft underneath is untouched,
 * same as every other overlay in this app), or explicitly acknowledge
 * and send anyway (onAcknowledgeAndSend) — there is no third, silent
 * path; a `warn` disposition can only ever proceed through this
 * explicit action (tempa_private.consume_safety_evaluation's own
 * p_warning_acknowledged requirement).
 *
 * Same dialog conventions as every other overlay in this app
 * (app/letters/[letterId]/source-letter-panel.tsx, app/minds/
 * discovery-results.tsx): role="dialog" aria-modal, Escape-to-cancel,
 * backdrop click-to-cancel, body-scroll lock while open.
 */
export default function SafetyWarningDialog({
  open,
  onCancel,
  onAcknowledgeAndSend,
  sending,
  actionLabel = 'Send anyway',
  sendingLabel = 'Sending…',
  copyKey,
}: {
  open: boolean
  onCancel: () => void
  onAcknowledgeAndSend: () => void
  sending: boolean
  /** Checkpoint 4 — the natural verb for the surface calling this
   * shared dialog ("Publish anyway", "Save anyway", "Post anyway"),
   * while every composer still shares this one component/copy. Letter
   * composers pass nothing and keep the original "Send anyway". */
  actionLabel?: string
  sendingLabel?: string
  /** Phase 1 — the opaque, server-chosen copy key (never a reason
   * code). 'safety_contact_sharing' shows the personal-contact privacy
   * reminder wording; anything else keeps the generic pause. */
  copyKey?: string
}) {
  const isContactNote = copyKey === SAFETY_CONTACT_SHARING_COPY_KEY
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-foreground/40" onClick={onCancel} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="safety-warning-title"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md space-y-4 rounded-lg border border-foreground/10 bg-background p-6 shadow-lg"
      >
        <h2 id="safety-warning-title" className="text-[17px] font-medium text-foreground">
          {isContactNote ? SAFETY_NOTE_TITLE : SAFETY_WARNING_TITLE}
        </h2>
        {isContactNote ? (
          SAFETY_CONTACT_BODY.map((paragraph) => (
            <p key={paragraph} className="text-[15px] leading-relaxed text-foreground/80">
              {paragraph}
            </p>
          ))
        ) : (
          <p className="text-[15px] leading-relaxed text-foreground/80">{SAFETY_WARNING_BODY}</p>
        )}
        <div className="flex flex-wrap gap-3 pt-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {isContactNote ? SAFETY_CONTACT_REVIEW_ACTION : 'Let me look again'}
          </button>
          <button type="button" onClick={onAcknowledgeAndSend} disabled={sending} className={primaryButtonClass}>
            {sending ? sendingLabel : isContactNote ? SAFETY_CONTACT_SEND_ACTION : actionLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
