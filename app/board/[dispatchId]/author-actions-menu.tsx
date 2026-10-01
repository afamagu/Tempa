'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { shareDispatch, revokeDispatchShare, pinDispatch, unpinDispatch, deleteDispatch } from '@/lib/dispatches'
import { helperTextClass, secondaryButtonClass, destructiveButtonClass, iconButtonClass } from '@/app/profile/ui'
import Tooltip from '@/app/profile/tooltip'

function KebabIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  )
}

/** The Dispatch author's restrained actions control. Every mutation is
 * still re-validated server-side; these booleans only keep the UI from
 * advertising actions the current read already knows cannot succeed. */
export default function AuthorActionsMenu({
  dispatchId,
  initialShareToken,
  initialIsPinned,
  momentImagePaths,
  editable,
  deletable = true,
  allowPin = true,
  editHref,
}: {
  dispatchId: string
  initialShareToken: string | null
  initialIsPinned: boolean
  momentImagePaths: string[]
  editable: boolean
  /** False once this read can already see a Reply. delete_dispatch is
   * still the authority and permanently refuses deletion after ANY Reply
   * has ever existed, including a later-hidden/tombstoned one. */
  deletable?: boolean
  /** Official/Sponsored Dispatches are never pinned to the creating
   * admin's member profile. */
  allowPin?: boolean
  /** Official/Sponsored Dispatches edit through Admin Content. */
  editHref?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [shareToken, setShareToken] = useState(initialShareToken)
  const [isPinned, setIsPinned] = useState(initialIsPinned)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function closeMenu() {
    setOpen(false)
    setConfirmingDelete(false)
    setError(null)
    setCopied(false)
  }

  async function handleShare() {
    if (busy) return
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const { data, error: shareError } = await shareDispatch(createClient(), dispatchId)
      if (shareError || !data) {
        setError('Could not share this Dispatch. Please try again.')
        return
      }
      setShareToken(data.id)
      const url = `${window.location.origin}/d/${data.id}`
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url)
        setCopied(true)
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleStopSharing() {
    if (busy) return
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const { error: revokeError } = await revokeDispatchShare(createClient(), dispatchId)
      if (revokeError) {
        setError('Could not stop sharing. Please try again.')
        return
      }
      setShareToken(null)
      closeMenu()
    } finally {
      setBusy(false)
    }
  }

  async function handleTogglePin() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: pinError } = isPinned
        ? await unpinDispatch(supabase)
        : await pinDispatch(supabase, dispatchId)
      if (pinError) {
        setError(isPinned ? 'Could not unpin. Please try again.' : 'Could not pin. Please try again.')
        return
      }
      setIsPinned(!isPinned)
      closeMenu()
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (busy || !deletable) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: deleteError } = await deleteDispatch(supabase, dispatchId)
      if (deleteError) {
        setError(
          deleteError.message === 'This Dispatch cannot be deleted while it still has Replies.'
            ? deleteError.message
            : 'Could not delete this Dispatch. Please try again.'
        )
        return
      }
      if (momentImagePaths.length > 0) {
        await supabase.storage.from('dispatch-photos').remove(momentImagePaths)
      }
      router.push('/board')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <Tooltip label="Dispatch options">
        <button type="button" onClick={() => setOpen(true)} aria-label="Dispatch options" className={iconButtonClass}>
          <KebabIcon />
        </button>
      </Tooltip>

      {open && (
        <>
          <div
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-lg border-t border-foreground/10 bg-background p-4 shadow-lg
              sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72 sm:rounded-lg sm:border sm:p-3"
          >
            {!confirmingDelete ? (
              <div className="flex flex-col gap-1.5">
                {editable && (
                  <Link
                    href={editHref ?? `/board/${dispatchId}/edit`}
                    className={secondaryButtonClass}
                    onClick={closeMenu}
                  >
                    Edit Dispatch
                  </Link>
                )}
                {allowPin && (
                  <button type="button" onClick={handleTogglePin} disabled={busy} className={secondaryButtonClass}>
                    {isPinned ? 'Unpin from profile' : 'Pin to profile'}
                  </button>
                )}
                {shareToken ? (
                  <button type="button" onClick={handleStopSharing} disabled={busy} className={secondaryButtonClass}>
                    Stop sharing externally
                  </button>
                ) : (
                  <button type="button" onClick={handleShare} disabled={busy} className={secondaryButtonClass}>
                    Share externally
                  </button>
                )}
                {copied && <p className={`px-1 ${helperTextClass}`}>Link copied.</p>}
                {error && <p className="px-1 text-sm text-red-600">{error}</p>}

                <div className="my-1 border-t border-foreground/10" />

                {deletable ? (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={busy}
                    className={destructiveButtonClass}
                  >
                    Delete Dispatch
                  </button>
                ) : (
                  <p className={`px-1 py-2 ${helperTextClass}`}>
                    This Dispatch has responses and can no longer be deleted.
                  </p>
                )}

                <button type="button" onClick={closeMenu} className={`w-full py-2 text-center ${helperTextClass}`}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className={helperTextClass}>Delete this Dispatch permanently?</p>
                <p className={helperTextClass}>
                  It will disappear from The Board and from your profile, and any external share link
                  will stop working. This cannot be undone.
                </p>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={busy}
                    className={secondaryButtonClass}
                  >
                    Cancel
                  </button>
                  <button type="button" onClick={handleDelete} disabled={busy} className={destructiveButtonClass}>
                    {busy ? 'Deleting…' : 'Delete permanently'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div role="presentation" onClick={closeMenu} className="fixed inset-0 z-40 hidden sm:block" />
        </>
      )}
    </div>
  )
}
