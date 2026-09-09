'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { quietLinkClass } from '@/app/profile/ui'

/**
 * The actual three-choice photo-consent decision — the ONE place that
 * ever calls respond_photo_sharing. Deliberately factored out of
 * LockedPhotoMoment so it can also be reached from PhotoConsent
 * directly: the decision surface must not depend on whether the
 * current viewer happens to be able to see the triggering photo.
 *
 * That gap is real, not hypothetical: with exactly two participants,
 * whoever reconsiders a photo_free choice was, by definition, the
 * non-sender of the original photo — so reconsideration always flips
 * "who owes the decision" to the photo's own sender, the one person who
 * can never see it as locked (can_view_letter_photo's sender clause is
 * unconditional on consent state). LockedPhotoMoment only ever mounts
 * where a Moment is actually locked for the viewer, so that person
 * would have no path to these choices anywhere in the UI without this
 * component also being reachable from PhotoConsent's banner.
 *
 * `showMaybeLater` should be `status === 'pending'` — mirrors
 * respond_photo_sharing's own rule that 'defer' is only a valid
 * decision the first time (from 'pending'), never once already
 * 'deferred'.
 */
export default function PhotoConsentChoices({
  correspondenceId,
  showMaybeLater,
}: {
  correspondenceId: string
  showMaybeLater: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function respond(decision: 'enable' | 'defer' | 'photo_free') {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.rpc('respond_photo_sharing', {
      p_correspondence_id: correspondenceId,
      p_decision: decision,
    })
    setBusy(false)
    if (err) {
      setError('Could not save your choice. Please try again.')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col items-start gap-2">
        <button type="button" onClick={() => respond('enable')} disabled={busy} className={quietLinkClass}>
          View this photo and allow photo sharing
        </button>
        {showMaybeLater && (
          <button type="button" onClick={() => respond('defer')} disabled={busy} className={quietLinkClass}>
            Maybe later
          </button>
        )}
        <button type="button" onClick={() => respond('photo_free')} disabled={busy} className={quietLinkClass}>
          Keep this correspondence photo-free
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
