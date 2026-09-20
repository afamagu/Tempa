'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { removeMyPostcard, type MyPostcard } from '@/lib/keepsakes'
import LetterheadPostcard from '@/app/letters/letterhead-postcard'
import { helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import { formatDateTimeFull } from '@/lib/format-date'

/**
 * Admin Phase 2A-2 — one delivered Postcard in Keepsakes. Reuses
 * LetterheadPostcard verbatim (the same closed-thumbnail /
 * tap-to-open-the-real-PostcardObject component the letter reader and
 * Preview already use) — no second visual Postcard engine. "Remove
 * from my Postcards" only ever records a per-recipient suppression
 * (lib/keepsakes.ts's removeMyPostcard); the original letter, its
 * Postcard, and the sender's own history are all completely untouched
 * — reopening the original letter still shows this Postcard exactly as
 * it always did.
 */
export default function KeepsakePostcardCard({ postcard }: { postcard: MyPostcard }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removed, setRemoved] = useState(false)

  async function handleRemove() {
    setBusy(true)
    setError(null)
    const { error: actionError } = await removeMyPostcard(createClient(), postcard.letterId)
    setBusy(false)
    if (actionError) {
      setError('Could not remove this Postcard. Please try again.')
      return
    }
    setRemoved(true)
    router.refresh()
  }

  if (removed) return null

  return (
    <article className="flex min-h-56 flex-col rounded-lg border border-foreground/10 bg-background p-4 transition hover:border-foreground/20 hover:shadow-sm">
      <div className="mb-3 min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{postcard.base.title}</p>
        <p className="truncate text-xs text-muted">{postcard.base.location}</p>
      </div>
      <LetterheadPostcard
        base={postcard.base}
        revealLine={postcard.revealLine}
        backMessage={postcard.backMessage}
        senderPseudonym={postcard.senderPseudonymSnapshot}
      />
      <p className={`mt-auto pt-4 ${helperTextClass}`}>
        From {postcard.senderPseudonymSnapshot} · {formatDateTimeFull(postcard.deliveredAt)}
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link href={`/letters/${postcard.letterId}`} className={secondaryButtonClass}>
          View original letter
        </Link>
        <button type="button" onClick={handleRemove} disabled={busy} className={helperTextClass}>
          {busy ? 'Removing…' : 'Remove from my Postcards'}
        </button>
      </div>
    </article>
  )
}
