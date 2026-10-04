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
 * Tempa's private Keep control — a bookmark ribbon, never a heart/eye/bell.
 * Private to the viewer: there is no count anywhere, and this never notifies
 * the person being kept or the Dispatch's author. Never rendered on a
 * viewer's own Dispatch.
 *
 * The unselected label names the person ("Keep Evening Quill") so it cannot
 * be mistaken for saving the Dispatch itself. The selected label is simply
 * "Kept". Both labels occupy the same grid cell so toggling never shifts the
 * surrounding layout.
 *
 * The database/RPC names keepMind/unkeepMind are legacy internal identifiers;
 * they are intentionally left untouched in this UI-only terminology pass.
 */
export default function KeepButton({
  viewerId,
  keptUserId,
  keptPseudonym,
  initiallyKept,
}: {
  viewerId: string
  keptUserId: string
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
      aria-label={kept ? `Kept ${keptPseudonym} — tap to remove` : `Keep ${keptPseudonym}`}
      className={`flex shrink-0 flex-col items-center gap-0.5 rounded-md px-2 py-1.5 transition-colors ${
        kept ? 'text-accent' : 'text-foreground/40 hover:text-foreground/70'
      }`}
    >
      <BookmarkRibbonIcon filled={kept} />
      <span className="grid text-[11px]">
        <span className={`col-start-1 row-start-1 whitespace-nowrap ${kept ? '' : 'invisible'}`}>Kept</span>
        <span className={`col-start-1 row-start-1 whitespace-nowrap ${kept ? 'invisible' : helperTextClass}`}>
          Keep {keptPseudonym}
        </span>
      </span>
    </button>
  )
}
