'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createReply, replyBodyError, REPLY_MAX_CHARS } from '@/lib/replies'
import { helperTextClass, inputClass, secondaryButtonClass, primaryButtonClass, tertiaryButtonClass } from '@/app/profile/ui'

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

  function reset() {
    setOpen(false)
    setBody('')
    setError(null)
    setBusy(false)
  }

  function cancel() {
    reset()
    onDone?.()
  }

  async function handleSubmit() {
    if (busy) return
    const validationError = replyBodyError(body)
    if (validationError) {
      setError(validationError)
      return
    }

    setBusy(true)
    setError(null)

    const { error: createError } = await createReply(createClient(), {
      dispatchId,
      body,
      parentReplyId,
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
    </div>
  )
}
