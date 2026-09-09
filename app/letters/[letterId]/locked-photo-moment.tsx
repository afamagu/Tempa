'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { helperTextClass, quietLinkClass } from '@/app/profile/ui'
import { isPhotoDecisionOutstandingForUser, canReconsiderPhotoFree, type PhotoConsentStatus } from '@/lib/letters'
import PhotoConsentChoices from './photo-consent-choices'

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect x="5" y="10.5" width="14" height="9" rx="1.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

/**
 * Renders in a Photo Moment's exact position for whoever doesn't yet
 * have access to it (never the sender — they always see their own
 * photo, enforced server-side, so this component only ever mounts for
 * the person who's actually able to decide OR who is simply waiting).
 * Tapping it reveals exactly the decision the current photo_consent_status
 * calls for — or, if this viewer doesn't actually have one right now
 * (see below), an informational message instead of live buttons.
 *
 * Root cause this fixes: this component used to decide "show the full
 * three-choice UI" purely from `status !== 'photo_free'`, with no check
 * for WHO is viewing. That's correct for a first-time pending decision
 * (the only two people who ever see a locked photo are the sender,
 * routed elsewhere entirely, and the one recipient who owes the
 * decision) — but it breaks the moment someone reconsiders a photo_free
 * choice: request_photo_sharing makes the RECONSIDERING RESOLVER the
 * new photo_consent_requested_by and flips status to 'pending'. That
 * person is still not the photo's sender, so they still land here —
 * and with no requester check, they'd see the same three live buttons
 * as the person who actually owes the decision. Clicking one calls
 * respond_photo_sharing, which correctly rejects a requester acting on
 * their own request ("You cannot respond to your own request") — but
 * the UI had already offered them an action they were never allowed to
 * take, surfacing as a confusing generic save failure. Gating on the
 * same isPhotoDecisionOutstandingForUser predicate PhotoConsent already
 * uses fixes this: the reconsidering requester now correctly sees only
 * "still waiting," never live buttons.
 */
export default function LockedPhotoMoment({
  id,
  correspondenceId,
  status,
  requestedBy,
  resolvedBy,
  userId,
  otherPseudonym,
}: {
  /** DOM id, stable per Moment (see letter-body.tsx) — lets the pending-
   * photo notice (photo-consent.tsx) and the composer's blocked-photo
   * message link/scroll straight to this exact locked Moment. */
  id?: string
  correspondenceId: string
  status: PhotoConsentStatus
  requestedBy: string | null
  resolvedBy: string | null
  userId: string
  otherPseudonym: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reconsiderBusy, setReconsiderBusy] = useState(false)
  const [reconsiderError, setReconsiderError] = useState<string | null>(null)

  const canReconsider = canReconsiderPhotoFree({ status, resolvedBy }, userId)
  const outstanding = isPhotoDecisionOutstandingForUser({ status, requestedBy, resolvedBy }, userId)

  async function reconsider() {
    setReconsiderBusy(true)
    setReconsiderError(null)
    const supabase = createClient()
    const { error: err } = await supabase.rpc('request_photo_sharing', {
      p_correspondence_id: correspondenceId,
    })
    setReconsiderBusy(false)
    if (err) {
      setReconsiderError('Could not do that right now. Please try again.')
      return
    }
    router.refresh()
  }

  return (
    <div id={id} className="my-3 scroll-mt-20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mx-auto flex w-[140px] flex-col items-center gap-1.5 rounded-md border border-dashed border-foreground/25 bg-foreground/[.03] px-3 py-6 text-foreground/60 transition-colors hover:border-foreground/40"
      >
        <LockIcon />
        <span className="text-[11px] font-medium">Photo waiting</span>
      </button>

      {open && (
        <div className="mx-auto mt-2 w-full max-w-sm space-y-3 rounded-md border border-foreground/10 p-4">
          {canReconsider ? (
            <>
              <p className={helperTextClass}>You chose to keep this correspondence photo-free.</p>
              {reconsiderError && <p className="text-sm text-red-600">{reconsiderError}</p>}
              <button type="button" onClick={reconsider} disabled={reconsiderBusy} className={quietLinkClass}>
                Ask about photos
              </button>
            </>
          ) : status === 'photo_free' ? (
            <p className={helperTextClass}>They&apos;d prefer to keep this correspondence photo-free.</p>
          ) : outstanding ? (
            <>
              <p className="text-[14px] font-semibold text-foreground">A photo is waiting</p>
              <p className={helperTextClass}>
                {otherPseudonym} included a photo in this letter.
                <br />
                Photos become visible only when both people are comfortable exchanging them.
              </p>
              <PhotoConsentChoices correspondenceId={correspondenceId} showMaybeLater={status === 'pending'} />
              {/* A local dismiss, not a third decision — never calls
                  respond_photo_sharing, so it's kept visually apart from
                  the shared decision controls above (its own row,
                  quieter/underlined styling) rather than looking like a
                  peer option among them. */}
              {status === 'deferred' && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className={`${helperTextClass} underline`}
                >
                  Not now
                </button>
              )}
            </>
          ) : (
            // Not outstanding for THIS viewer and not photo_free: either
            // pending (they're the requester, still waiting on the other
            // person) or deferred (same — deferred's resolver is always
            // the outstanding branch above, never the requester).
            <p className={helperTextClass}>
              {status === 'deferred'
                ? "They'd prefer to wait before exchanging photos."
                : 'Photo sharing is still waiting for their decision.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
