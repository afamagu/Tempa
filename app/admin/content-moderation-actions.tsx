'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  hideDispatch,
  restoreDispatch,
  hideQuestionAnswer,
  restoreQuestionAnswer,
  type ContentType,
  type ModerationStatus,
} from '@/lib/admin-moderation'
import { helperTextClass, secondaryButtonClass, destructiveButtonClass, inputClass, fieldLabelClass } from '@/app/profile/ui'

/**
 * Hide / Restore — the entire content-moderation surface for a
 * Dispatch or Question answer, reused identically from report detail
 * and Public Content Review. Same interaction shape as
 * AccountStatusActions (Phase 1): a reason is always required before
 * either action (matching the hide/restore RPCs' own server-side
 * requirement — this UI just makes that step visible rather than a
 * silent server error), no one-click destructive action. Never edits
 * title/body/prompt — structurally cannot, since neither RPC this
 * calls has any column reference to either.
 */
export default function ContentModerationActions({
  contentType,
  contentId,
  currentStatus,
}: {
  contentType: ContentType
  contentId: string
  currentStatus: ModerationStatus
}) {
  const router = useRouter()
  const [pending, setPending] = useState<'hide' | 'restore' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (busy || !pending) return
    if (reason.trim().length === 0) {
      setError('A reason is required.')
      return
    }
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const action =
      contentType === 'dispatch'
        ? pending === 'hide'
          ? hideDispatch
          : restoreDispatch
        : pending === 'hide'
          ? hideQuestionAnswer
          : restoreQuestionAnswer

    const { error: actionError } = await action(supabase, contentId, reason)

    setBusy(false)

    if (actionError) {
      setError('Could not update this content. Please try again.')
      return
    }

    setPending(null)
    setReason('')
    router.refresh()
  }

  if (pending) {
    return (
      <div className="space-y-3 rounded-md border border-foreground/10 p-3">
        <p className="text-[14px] font-medium text-foreground">
          {pending === 'hide' ? 'Hide this content?' : 'Restore this content?'}
        </p>
        <div>
          <label className={fieldLabelClass} htmlFor="content-moderation-reason">
            Reason (required)
          </label>
          <textarea
            id="content-moderation-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            maxLength={500}
            rows={3}
            className={`mt-2 ${inputClass}`}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setPending(null)
              setReason('')
              setError(null)
            }}
            disabled={busy}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} disabled={busy} className={destructiveButtonClass}>
            {busy ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className={helperTextClass}>Content status: {currentStatus}</p>
      <div className="flex flex-wrap gap-2">
        {currentStatus === 'visible' ? (
          <button type="button" onClick={() => setPending('hide')} className={destructiveButtonClass}>
            Hide
          </button>
        ) : (
          <button type="button" onClick={() => setPending('restore')} className={secondaryButtonClass}>
            Restore
          </button>
        )}
      </div>
    </div>
  )
}
