'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { setDispatchWorthReading } from '@/lib/worth-reading'
import { focusRingClass } from '@/app/profile/ui'

/**
 * Worth Reading's one interactive control — a small framed plaque/sign
 * (the --verdigris token, app/globals.css), deliberately NOT a pill and
 * NOT a bare line of text: a recognizable TEMPA object with a dormant
 * and a softly-illuminated state, never a checkmark/heart/star/upvote,
 * never a count, never an animation. Private to the viewer: there is no
 * count anywhere, and this never notifies the Dispatch's author. Never
 * rendered on a viewer's own Dispatch — a member cannot mark
 * themselves worth reading (set_dispatch_worth_reading enforces this
 * server-side regardless; the caller simply doesn't render this for
 * dispatch.authorId === viewerId, matching KeepButton's own
 * precedent).
 *
 * The tiny left dot is a purely decorative "pilot light" — hollow when
 * dormant, filled when selected. The real state lives in aria-pressed,
 * never in the dot's presence or the label text, which reads "WORTH
 * READING" identically in both states.
 */
export default function WorthReadingButton({
  dispatchId,
  initiallyMarked,
}: {
  dispatchId: string
  initiallyMarked: boolean
}) {
  const router = useRouter()
  const [marked, setMarked] = useState(initiallyMarked)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    if (busy) return
    setBusy(true)
    const supabase = createClient()
    try {
      const { error } = await setDispatchWorthReading(supabase, dispatchId, !marked)
      if (!error) {
        setMarked(!marked)
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={marked}
      aria-label={marked ? 'Worth reading — tap to undo' : 'Mark this Dispatch worth reading'}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] font-medium tracking-wide transition-colors ${focusRingClass} ${
        marked
          ? 'border-verdigris/60 bg-verdigris/10 text-verdigris shadow-[0_0_10px_2px_color-mix(in_srgb,var(--color-verdigris)_18%,transparent)] hover:border-verdigris/80'
          : 'border-verdigris/25 bg-surface-shell text-foreground/70 hover:border-verdigris/40 hover:bg-verdigris/[.05]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${marked ? 'bg-verdigris' : 'border border-verdigris/40'}`}
      />
      WORTH READING
    </button>
  )
}
