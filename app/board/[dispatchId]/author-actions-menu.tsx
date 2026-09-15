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

/**
 * The Dispatch author's restrained actions control — one icon-only
 * trigger opening a bottom sheet, rather than four large buttons
 * cluttering the reading header (Board usability checkpoint,
 * 2026-09-09). Same bottom-sheet grammar as the composer's own photo-
 * source picker (dispatch-composer.tsx) — deliberately reused rather
 * than inventing a dropdown/click-outside pattern this codebase doesn't
 * otherwise have. Delete uses an inline confirm swap within the same
 * sheet (the established pattern — see app/letters/remove-from-
 * letterbox.tsx), never a native window.confirm().
 *
 * Edit/Share/Stop-sharing/Pin/Delete are all re-validated author-side by
 * their own RPCs regardless of anything this component does — it exists
 * for a restrained presentation, not as the actual authorization
 * boundary.
 *
 * Board live-test corrections (2026-09-10): two changes from the
 * checkpoint that first shipped this menu. (1) Item order/spacing —
 * live testing found the mobile sheet cramped and hierarchy unclear;
 * the fixed order is now Edit, Pin/Unpin, Share/Stop-sharing, a divider,
 * then destructive Delete, then a quiet full-width Cancel, each with
 * real separation. (2) A "Share externally" action now appears here
 * too when nothing is currently shared — previously the ONLY way to
 * start sharing was the separate, always-visible ShareDispatchButton
 * next to this menu, so this menu's own language ("Stop sharing
 * externally" with nothing to start it) was inconsistent. Sharing again
 * after a stop always produces a brand-new token (share_dispatch's own
 * get-or-create semantics — see lib/dispatches.ts) — the old link never
 * resurrects.
 *
 * Desktop gets a restrained anchored popover instead of a full-width
 * mobile sheet (sm: breakpoint) — same content, just not an oversized
 * sheet on a pointer-driven layout with room to spare.
 */
export default function AuthorActionsMenu({
  dispatchId,
  initialShareToken,
  initialIsPinned,
  momentImagePaths,
}: {
  dispatchId: string
  initialShareToken: string | null
  initialIsPinned: boolean
  /** This Dispatch's own Moment storage paths, fetched by the reader
   * page BEFORE deletion — once delete_dispatch succeeds the
   * dispatch_moments rows naming these paths are already gone, so the
   * caller must already hold them to clean up storage afterward. */
  momentImagePaths: string[]
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
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: deleteError } = await deleteDispatch(supabase, dispatchId)
      if (deleteError) {
        // Board Experience Phase 2B pre-SQL correction: a Dispatch with
        // Replies cannot be deleted at all right now (see delete_
        // dispatch's own guard) — "Please try again" would be
        // misleading for that specific, permanent condition, so it gets
        // its own coherent message instead of the generic retry copy.
        setError(
          deleteError.message === 'This Dispatch cannot be deleted while it still has Replies.'
            ? deleteError.message
            : 'Could not delete this Dispatch. Please try again.'
        )
        return
      }
      if (momentImagePaths.length > 0) {
        // Best-effort cleanup — the Dispatch is already gone from the
        // Board and profile regardless of whether this succeeds. A
        // failure here leaves an orphaned image in the author's own
        // private storage folder: not a security issue (still private,
        // still only reachable under that same author-scoped storage
        // policy), just untidy. See the Build Guide's own note on this
        // known, explicitly recorded gap.
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
          {/* Mobile: a bottom sheet. Desktop (sm:): a restrained anchored
              popover under the trigger instead — same content, not an
              oversized full-width sheet where there's room for a small
              menu. */}
          <div
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-lg border-t border-foreground/10 bg-background p-4 shadow-lg
              sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72 sm:rounded-lg sm:border sm:p-3"
          >
            {!confirmingDelete ? (
              <div className="flex flex-col gap-1.5">
                <Link
                  href={`/board/${dispatchId}/edit`}
                  className={secondaryButtonClass}
                  onClick={closeMenu}
                >
                  Edit Dispatch
                </Link>
                <button type="button" onClick={handleTogglePin} disabled={busy} className={secondaryButtonClass}>
                  {isPinned ? 'Unpin from profile' : 'Pin to profile'}
                </button>
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

                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={busy}
                  className={destructiveButtonClass}
                >
                  Delete Dispatch
                </button>

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

          {/* Desktop-only backdrop to close the popover on an outside
              click — the mobile sheet relies on Cancel/an action instead,
              matching this codebase's existing bottom-sheet convention.
              A plain div, not a button: purely a click target, never
              meant to be reachable by keyboard/AT (Cancel/Escape-less
              popover dismissal is a pointer-only convenience here). */}
          <div role="presentation" onClick={closeMenu} className="fixed inset-0 z-40 hidden sm:block" />
        </>
      )}
    </div>
  )
}
