'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { keepMind, unkeepMind } from '@/lib/dispatches'
import { helperTextClass } from '@/app/profile/ui'

function BookmarkRibbonIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M6 4.5h12v15l-6-4-6 4Z" />
    </svg>
  )
}

/**
 * Keep in Mind's one interactive control — a bookmark ribbon, never a
 * heart/eye/bell (those were explicitly rejected — see the Build
 * Guide's Dispatches section). Private to the viewer: there is no
 * count anywhere, and this never notifies the kept person or the
 * Dispatch's author. Never rendered on a viewer's own Dispatch — a
 * member cannot Keep themselves (kept_minds_no_self_keep enforces this
 * server-side regardless; callers should simply not render this for
 * dispatch.authorId === viewerId).
 *
 * Board usability checkpoint (2026-09-09): the unselected label reads
 * "Keep <pseudonym>", not a bare "Keep" — a bare "Keep" read as
 * ambiguous, easily mistaken for saving the Dispatch itself rather
 * than the private relationship to its writer that Keep in Mind
 * actually is. The locked concept name ("Keep in Mind"), the selected
 * label ("In mind"), and the bookmark-ribbon icon are all unchanged.
 *
 * Layout stability (Board live-test corrections, 2026-09-10): "In mind"
 * and "Keep <pseudonym>" are different lengths, and toggling between
 * them was visibly shifting the surrounding row (e.g. squeezing
 * DispatchCard's identity row). Both labels are rendered simultaneously
 * stacked in the same CSS grid cell — only one is ever visible
 * (`invisible`, not `hidden`, so it still occupies space) — so the
 * control's box always reserves room for the WIDER of the two possible
 * labels for this specific pseudonym, and toggling never changes the
 * button's own width. Font size/line-height/icon/padding are identical
 * in both states regardless.
 */
export default function KeepButton({
  viewerId,
  keptUserId,
  keptPseudonym,
  initiallyKept,
}: {
  viewerId: string
  keptUserId: string
  /** The person being kept, for the unselected label ("Keep Evening
   * Quill") — Keep is a relationship to THIS PERSON, never to the
   * Dispatch being read, and the label now says so explicitly. */
  keptPseudonym: string
  initiallyKept: boolean
}) {
  const router = useRouter()
  const [kept, setKept] = useState(initiallyKept)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    if (busy) return
    setBusy(true)
    const supabase = createClient()
    try {
      const { error } = kept
        ? await unkeepMind(supabase, viewerId, keptUserId)
        : await keepMind(supabase, viewerId, keptUserId)
      if (!error) {
        setKept(!kept)
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
      aria-pressed={kept}
      aria-label={kept ? `In mind — tap to stop keeping ${keptPseudonym} in mind` : `Keep ${keptPseudonym} in mind`}
      className={`flex shrink-0 flex-col items-center gap-0.5 rounded-md px-2 py-1.5 transition-colors ${
        kept ? 'text-accent' : 'text-foreground/40 hover:text-foreground/70'
      }`}
    >
      <BookmarkRibbonIcon filled={kept} />
      <span className="grid text-[11px]">
        <span className={`col-start-1 row-start-1 whitespace-nowrap ${kept ? '' : 'invisible'}`}>In mind</span>
        <span className={`col-start-1 row-start-1 whitespace-nowrap ${kept ? 'invisible' : helperTextClass}`}>
          Keep {keptPseudonym}
        </span>
      </span>
    </button>
  )
}
