'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { acknowledgeCorrespondenceFeature } from '@/lib/acknowledgements'
import { systemMarkerClass, systemBodyClass, compactSecondaryButtonClass } from '@/app/profile/ui'

/**
 * Shown instead of the full walkthrough once a member has already been
 * through it once (globally) and a *different* correspondence becomes
 * active — a quiet acknowledgement, not a re-teaching moment.
 *
 * Whether to render this at all is decided server-side, in
 * app/letters/[letterId]/page.tsx, from
 * correspondence_feature_acknowledgements — real per-account state, not
 * browser storage, so it's seen once per correspondence episode
 * regardless of device. That means this component never needs its own
 * show/hide logic or state: it always renders its content when mounted,
 * and its only job is to record the acknowledgement once the member has
 * genuinely seen it.
 *
 * The write happens in a plain mount effect, not during render or on
 * the server — same reasoning as MarkLetterOpened: a client effect only
 * ever runs once this actually mounts in a browser, never during
 * Next.js Link prefetching, which is what keeps a mere hover from
 * falsely recording an acknowledgement nobody actually saw.
 */
export default function MomentsAvailableNotice({
  correspondenceId,
  otherPseudonym,
  composeHref,
}: {
  correspondenceId: string
  otherPseudonym: string
  composeHref: string
}) {
  useEffect(() => {
    const supabase = createClient()
    acknowledgeCorrespondenceFeature(supabase, correspondenceId, 'moments_available')
  }, [correspondenceId])

  return (
    <div className="mt-4 space-y-2 rounded-md border border-foreground/10 px-4 py-3">
      <p className={systemMarkerClass}>⊕ Moments</p>
      <p className="text-[14px] font-semibold text-foreground">Moments are available here</p>
      <p className={systemBodyClass}>
        You and {otherPseudonym} have both chosen to continue writing. You can now add Moments
        to your letters.
      </p>
      <p className={systemBodyClass}>
        Share a photograph when it belongs naturally in what you&apos;re writing.
      </p>
      <Link href={composeHref} className={compactSecondaryButtonClass}>
        Continue writing
      </Link>
    </div>
  )
}
