'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createReply, replyBodyError, REPLY_MAX_CHARS } from '@/lib/replies'
import { helperTextClass, inputClass, secondaryButtonClass, primaryButtonClass, tertiaryButtonClass } from '@/app/profile/ui'
import {
  evaluateSafety,
  SAFETY_CANNOT_SEND_MESSAGE,
  SAFETY_CHECK_FAILED_MESSAGE,
  SAFETY_FINANCIAL_REQUEST_COPY_KEY,
} from '@/lib/safety/send-with-safety'
import SafetyWarningDialog from '@/app/safety-warning-dialog'
import SafetyBlockedDialog from '@/app/safety-blocked-dialog'

const CHAR_WARNING_THRESHOLD = Math.round(REPLY_MAX_CHARS * 0.875)

/**
 * The Reply composer — inline expand-in-place, the same interaction
 * shape as ReportButton (app/report-button.tsx): a quiet collapsed
 * trigger by default, expanding into a small textarea + Cancel/Post row
 * on click, never a modal. Used both for a new top-level Reply
 * (parentReplyId omitted) and for a Reply-to-Reply (parentReplyId set),
 * from the SAME component, so both paths stay visually and behaviorally
 * identical.
 *
 * Plain escaped text only — no rich-mark system, no Moment/image
 * attachment, no emoji/reaction picker. React's default text escaping
 * is the entire XSS model here, matching every other user-text surface
 * in this codebase (confirmed: dangerouslySetInnerHTML is used nowhere
 * in this repo).
 */
export default function ReplyComposer({
  dispatchId,
  parentReplyId,
  triggerLabel = 'Reply',
  triggerClassName = tertiaryButtonClass,
  autoFocus = false,
  onDone,
}: {
  dispatchId: string
  /** Omit for a new top-level Reply; pass the parent Reply's id for a
   * Reply-to-Reply. */
  parentReplyId?: string
  triggerLabel?: string
  triggerClassName?: string
  autoFocus?: boolean
  /** Called after a successful post (or Cancel) — callers use this to
   * collapse a per-Reply composer back to its trigger and to trigger a
   * refresh of the Replies list. */
  onDone?: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(autoFocus)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Safety 2, Checkpoint 4 — mirrors first-letter-composer.tsx's own
  // pendingWarning split exactly (see that file's own doc comment).
  const [pendingWarning, setPendingWarning] = useState<{ evaluationId: string; copyKey?: string } | null>(null)
  // Phase 1 — a confirmed financial solicitation is not sendable and has
  // no override; this only ever opens the calm SafetyBlockedDialog.
  const [financialBlocked, setFinancialBlocked] = useState(false)

  function reset() {
    setOpen(false)
    setBody('')
    setError(null)
    setBusy(false)
    setPendingWarning(null)
  }

  function cancel() {
    reset()
    onDone?.()
  }

  // Evaluates FIRST; only ever calls create_reply itself once that
  // evaluation resolves to allow (immediately) or the member explicitly
  // acknowledges a warning (handleAcknowledgeWarning below). A failed
  // evaluation never falls back to an unscreened post — see lib/safety/
  // send-with-safety.ts's own doc comment on why evaluateSafety is
  // fail-closed by construction.
  async function handleSubmit() {
    if (busy) return
    const validationError = replyBodyError(body)
    if (validationError) {
      setError(validationError)
      return
    }

    setBusy(true)
    setError(null)

    const outcome = await evaluateSafety({ surface: 'dispatch_reply', dispatchId, parentReplyId, body })

    if (outcome.status === 'error') {
      setError(SAFETY_CHECK_FAILED_MESSAGE)
      setBusy(false)
      return
    }
    if (outcome.status === 'cannot_send') {
      if (outcome.copyKey === SAFETY_FINANCIAL_REQUEST_COPY_KEY) setFinancialBlocked(true)
      else setError(SAFETY_CANNOT_SEND_MESSAGE)
      setBusy(false)
      return
    }
    if (outcome.status === 'warning_required') {
      setPendingWarning({ evaluationId: outcome.evaluationId, copyKey: outcome.copyKey })
      setBusy(false)
      return
    }

    await postReply(outcome.evaluationId, false)
  }

  function handleCancelWarning() {
    setPendingWarning(null)
  }

  async function handleAcknowledgeWarning() {
    if (!pendingWarning) return
    await postReply(pendingWarning.evaluationId, true)
  }

  async function postReply(safetyEvaluationId: string, warningAcknowledged: boolean) {
    setBusy(true)
    setError(null)

    // Re-read body fresh at call time is unnecessary here (unlike the
    // editor-based composers) — body is already the single source of
    // truth this whole component reads from; create_reply's own
    // fingerprint recheck (tempa_private.consume_safety_evaluation)
    // still rejects it if it somehow changed since evaluation.
    const { error: createError } = await createReply(createClient(), {
      dispatchId,
      body,
      parentReplyId,
      safetyEvaluationId,
      warningAcknowledged,
    })

    setBusy(false)

    if (createError) {
      setError('Could not post this Reply. Please try again.')
      return
    }

    reset()
    onDone?.()
    router.refresh()
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={triggerClassName}>
        {triggerLabel}
      </button>
    )
  }

  const remaining = REPLY_MAX_CHARS - body.length

  return (
    <div className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, REPLY_MAX_CHARS))}
        maxLength={REPLY_MAX_CHARS}
        rows={3}
        autoFocus={autoFocus}
        placeholder="Write a Reply…"
        aria-label="Write a Reply"
        className={inputClass}
      />

      {body.length >= CHAR_WARNING_THRESHOLD && (
        <p className={helperTextClass}>{remaining} characters left</p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={cancel} disabled={busy} className={secondaryButtonClass}>
          Cancel
        </button>
        <button type="button" onClick={handleSubmit} disabled={busy} className={primaryButtonClass}>
          {busy ? 'Posting…' : 'Post Reply'}
        </button>
      </div>

      <SafetyWarningDialog
        open={pendingWarning !== null}
        copyKey={pendingWarning?.copyKey}
        onCancel={handleCancelWarning}
        onAcknowledgeAndSend={handleAcknowledgeWarning}
        sending={busy}
        actionLabel="Post anyway"
        sendingLabel="Posting…"
      />
      <SafetyBlockedDialog open={financialBlocked} onClose={() => setFinancialBlocked(false)} />
    </div>
  )
}
