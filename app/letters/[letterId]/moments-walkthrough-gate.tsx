'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { completeMomentsWalkthrough } from '@/lib/moments-guide'
import MomentsWalkthrough from '@/app/guide/moments-walkthrough'
import SystemIntro from '@/app/profile/system-intro'
import { primaryButtonClass } from '@/app/profile/ui'

/**
 * Rendered only when the server has already determined the full,
 * mandatory walkthrough should show (guide not yet completed,
 * correspondence qualifies, AND a real reply opportunity exists — see
 * page.tsx's showWalkthrough). This is a MANDATORY instructional
 * sequence: there is no skip/close path here at all (allowSkip={false}
 * below) — the only thing that can ever mark it complete is reaching
 * the final screen's "Continue writing" action. Leaving the app or
 * navigating away mid-tutorial writes nothing, so it correctly shows
 * again next time — there is deliberately no early-exit handler that
 * could mark completion on anything less than that.
 *
 * Completion also acknowledges 'moments_available' for THIS
 * correspondence at the same time: without that, the very next page
 * load after finishing the full tutorial would immediately show the
 * small "Moments are available here" notice too (guide now complete,
 * this correspondence never separately acknowledged) — a redundant
 * re-teaching moment right after the real one. The Tempa Guide replay
 * path (app/you/guide/moments/replay.tsx) has no correspondence context
 * and must never touch this table — only this in-correspondence gate
 * does.
 *
 * The actual write/navigate sequencing lives in
 * completeMomentsWalkthrough (lib/moments-guide.ts), kept out of this
 * component so it can be tested without React: both writes are
 * best-effort (a transient failure — or, historically, the missing
 * UPDATE grant fixed by
 * docs/sql/2026-09-01-guide-completions-update-grant.sql — must never
 * block the member from actually continuing into their letter) and
 * navigation is always attempted regardless of whether either write
 * succeeded. Only a genuine navigation failure shows the escape screen
 * below — this is the ONE circumstance in which a mandatory,
 * no-skip-allowed tutorial is allowed an exit that isn't "reach the end
 * normally," because the alternative is trapping the member behind a
 * screen with no Close/X and a dead button.
 *
 * `composeHref` is whatever the current member's actual next reply
 * opportunity in THIS correspondence is (computed server-side from the
 * same data that decided to show the tutorial at all) — page.tsx only
 * renders this gate when composeHref is non-null, so "Continue writing"
 * always has somewhere real to take the member; there is no
 * dismiss-in-place fallback state to manage here.
 */
export default function MomentsWalkthroughGate({
  correspondenceId,
  otherPseudonym,
  composeHref,
}: {
  correspondenceId: string
  otherPseudonym: string
  composeHref: string
}) {
  const router = useRouter()
  const [navigationFailed, setNavigationFailed] = useState(false)

  async function handleFinish() {
    const supabase = createClient()
    const outcome = await completeMomentsWalkthrough(supabase, correspondenceId, () =>
      router.push(composeHref)
    )

    if (outcome.guideError) {
      console.error('[moments-guide] completion write failed', outcome.guideError)
    }
    if (outcome.ackError) {
      console.error('[moments-guide] correspondence acknowledgement failed', outcome.ackError)
    }
    if (outcome.status === 'navigation-failed') {
      console.error('[moments-guide] navigation to composer failed', outcome.navigationError)
      setNavigationFailed(true)
    }
  }

  if (navigationFailed) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background p-6 text-center">
        <div className="w-full max-w-sm">
          <SystemIntro
            heading="Something went wrong"
            body={<p>We couldn&apos;t continue from here.</p>}
          />
        </div>
        <Link href="/letters" className={primaryButtonClass}>
          Return to Letters
        </Link>
      </div>
    )
  }

  return (
    <MomentsWalkthrough
      allowSkip={false}
      otherPseudonym={otherPseudonym}
      finalLabel="Continue writing"
      onFinish={handleFinish}
    />
  )
}
