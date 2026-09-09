'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { hideCorrespondenceForViewer } from '@/lib/letters'
import { helperTextClass, secondaryButtonClass, primaryButtonClass } from '@/app/profile/ui'
import Tooltip from '@/app/profile/tooltip'

/**
 * "Remove from my Letterbox" — viewer-local hiding only, through the
 * already-live correspondence_hidden_for_user backend
 * (hideCorrespondenceForViewer, lib/letters.ts). Never destructive:
 * letters, safety/report records, and the other participant's own
 * Letterbox are all untouched — this only stops the correspondence
 * from appearing in the CURRENT viewer's own Letterbox and search.
 * Shared between the letter reader's action menu
 * (app/letters/[letterId]/letter-action-menu.tsx) and the archive
 * header (app/letters/with/[userId]/page.tsx) so both use identical
 * copy and confirm-before-hiding behavior rather than two competing
 * implementations. Renders its own inline confirmation step — never a
 * native window.confirm(), which isn't consistently keyboard/screen-
 * reader friendly and can't carry Tempa's own copy.
 */
export default function RemoveFromLetterbox({
  correspondenceIds,
  triggerClassName,
  triggerLabel = 'Remove from my Letterbox',
  triggerIcon,
  confirmDescription = 'this correspondence',
}: {
  /** One episode from the letter reader (its own single
   * correspondenceId); every VISIBLE episode with this person from the
   * archive header (a pair can have more than one over time — removing
   * "this person" from Letterbox means removing all of them, not just
   * whichever episode happened to be shown). Always at least one. */
  correspondenceIds: string[]
  triggerClassName: string
  triggerLabel?: string
  /** Renders an icon-only trigger instead of triggerLabel as visible
   * text (e.g. the archive header's compact control) — triggerLabel is
   * still the button's accessible name (aria-label) and its Tooltip
   * text, so the action never loses its name just because the visible
   * text did. Omit for a plain text trigger (e.g. the per-letter menu
   * item), which needs neither. */
  triggerIcon?: ReactNode
  /** How the confirmation describes what's being removed — e.g. "your
   * correspondence with Evening Quill" from the archive header, left as
   * the generic default from the single-letter reader menu. */
  confirmDescription?: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setRemoving(true)
    setError(null)

    const supabase = createClient()
    const results = await Promise.all(
      correspondenceIds.map((id) => hideCorrespondenceForViewer(supabase, id))
    )

    setRemoving(false)

    if (results.some((ok) => !ok)) {
      setError('Could not remove this correspondence. Please try again.')
      return
    }

    router.push('/letters')
  }

  if (confirming) {
    return (
      <div className="space-y-2 p-1.5">
        <p className={helperTextClass}>Remove {confirmDescription} from your Letterbox?</p>
        <p className={helperTextClass}>
          This removes it from your Letterbox only. It stays visible to the other
          participant, and nothing is deleted.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={removing}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} disabled={removing} className={primaryButtonClass}>
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    )
  }

  const trigger = (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className={triggerClassName}
      aria-label={triggerIcon ? triggerLabel : undefined}
    >
      {triggerIcon ?? triggerLabel}
    </button>
  )

  return triggerIcon ? <Tooltip label={triggerLabel}>{trigger}</Tooltip> : trigger
}
