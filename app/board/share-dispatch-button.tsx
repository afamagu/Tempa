'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { shareDispatch } from '@/lib/dispatches'
import { helperTextClass } from '@/app/profile/ui'

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.7 15.8 6.3" />
      <path d="M8.2 13.3 15.8 17.7" />
    </svg>
  )
}

/**
 * Share for a published Dispatch — available to ANY authenticated
 * member reading it, not only its author (Board usability checkpoint,
 * 2026-09-09: sharing is a reader action on the writing, not a
 * privilege of authorship). Always calls share_dispatch — never
 * generates a token client-side, never inserts directly into
 * dispatch_shares; the RPC itself decides whether to reuse an existing
 * live token or create one, so any two members tapping Share on the
 * same Dispatch land on the identical link. The external link points
 * at the Dispatch itself — nothing here records or exposes who shared
 * it, and there is no share count anywhere.
 *
 * Deliberately stateless about "is this currently shared" — that
 * question, and the ability to stop sharing, belongs to the author
 * alone (see author-actions-menu.tsx); this component only ever offers
 * the one action, native share sheet when available, otherwise
 * copy-link with a quiet inline confirmation, never a blocking browser
 * alert.
 *
 * Deliberately labeled Share, never Forward — Forward is reserved
 * vocabulary that must never appear anywhere near private
 * correspondence (see the Build Guide's Dispatches/sharing section).
 */
export default function ShareDispatchButton({
  dispatchId,
  title,
  authorPseudonym,
  shareText,
}: {
  dispatchId: string
  title: string
  authorPseudonym: string
  /** Identity-aware share-sheet text (lib/dispatch-identity.ts's
   * dispatchShareText) — "from Tempa" / "Sponsored by …" / "by {member}". */
  shareText?: string
}) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleShare() {
    if (busy) return
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const supabase = createClient()
      const { data, error: shareError } = await shareDispatch(supabase, dispatchId)
      if (shareError || !data) {
        setError('Could not share this Dispatch. Please try again.')
        return
      }
      const url = `${window.location.origin}/d/${data.id}`

      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({ title, text: shareText ?? `${title} — by ${authorPseudonym} on Tempa`, url })
        } catch {
          // Cancelling the native share sheet (or the platform
          // rejecting it) is a normal outcome, not a failure — nothing
          // to surface.
        }
        return
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2500)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleShare}
        disabled={busy}
        aria-label="Share this Dispatch"
        className="flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 text-foreground/40 transition-colors hover:text-foreground/70"
      >
        <ShareIcon />
        <span className={`text-[11px] ${helperTextClass}`}>Share</span>
      </button>

      {copied && <span className={helperTextClass}>Link copied</span>}
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  )
}
