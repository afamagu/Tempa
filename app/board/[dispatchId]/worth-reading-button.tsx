'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { setDispatchWorthReading } from '@/lib/worth-reading'
import { helperTextClass } from '@/app/profile/ui'

/**
 * Worth Reading's one interactive control — a quiet text toggle, never
 * a count/badge/large button. Private to the viewer: there is no count
 * anywhere, and this never notifies the Dispatch's author. Never
 * rendered on a viewer's own Dispatch — a member cannot mark
 * themselves worth reading (set_dispatch_worth_reading enforces this
 * server-side regardless; the caller simply doesn't render this for
 * dispatch.authorId === viewerId, matching KeepButton's own
 * precedent).
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
      className={`text-[13px] font-medium transition-colors ${
        marked ? 'text-accent' : `${helperTextClass} hover:text-foreground`
      }`}
    >
      {marked ? '✓ Worth reading' : 'Worth reading'}
    </button>
  )
}
