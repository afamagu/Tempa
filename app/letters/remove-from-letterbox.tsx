'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { hideCorrespondenceForViewer } from '@/lib/letters'
import { helperTextClass, secondaryButtonClass, primaryButtonClass } from '@/app/profile/ui'
import Tooltip from '@/app/profile/tooltip'

/**
 * Viewer-local Letterbox housekeeping only. This never deletes shared history,
 * never ends a correspondence, and never changes first-contact eligibility.
 *
 * Confirmation is rendered as a real modal layer so activating this action
 * cannot crush the correspondent header or collide visually with archive
 * selection controls on small screens.
 */
export default function RemoveFromLetterbox({
  correspondenceIds,
  triggerClassName,
  triggerLabel = 'Remove from my Letterbox',
  triggerIcon,
  confirmDescription = 'this correspondence',
}: {
  correspondenceIds: string[]
  triggerClassName: string
  triggerLabel?: string
  triggerIcon?: ReactNode
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
    router.refresh()
  }

  const trigger = (
    <button
      type="button"
      onClick={() => {
        setError(null)
        setConfirming(true)
      }}
      className={triggerClassName}
      aria-label={triggerIcon ? triggerLabel : undefined}
    >
      {triggerIcon ?? triggerLabel}
    </button>
  )

  return (
    <>
      {triggerIcon ? <Tooltip label={triggerLabel}>{trigger}</Tooltip> : trigger}

      {confirming && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/25 p-3 sm:items-center sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !removing) setConfirming(false)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-letterbox-title"
            className="w-full max-w-md space-y-4 rounded-xl border border-foreground/10 bg-background p-5 shadow-xl"
          >
            <div className="space-y-2">
              <h2 id="remove-letterbox-title" className="text-[17px] font-medium text-foreground">
                Remove from your Letterbox?
              </h2>
              <p className={helperTextClass}>Remove {confirmDescription} from your Letterbox?</p>
              <p className={helperTextClass}>
                This hides it from your Letterbox only. Nothing is deleted for the other person,
                and it does not end the relationship or reset who can write to whom.
              </p>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={removing}
                className={secondaryButtonClass}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={removing}
                className={primaryButtonClass}
              >
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
