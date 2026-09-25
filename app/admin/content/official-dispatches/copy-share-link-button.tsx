'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { shareDispatch } from '@/lib/dispatches'
import { adminMetadataClass } from '@/app/admin/admin-ui'

/**
 * Admin Content — get (or create) this Dispatch's external share link
 * through the EXISTING share_dispatch infrastructure (unguessable token,
 * revocable from the Dispatch's own author menu) and copy it. Shows the
 * link inline too, so it can be copied by hand where the clipboard API
 * is unavailable.
 */
export default function CopyShareLinkButton({ dispatchId }: { dispatchId: string }) {
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    if (busy) return
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const { data, error: shareError } = await shareDispatch(createClient(), dispatchId)
      if (shareError || !data) {
        setError('Could not create a share link. Please try again.')
        return
      }
      const url = `${window.location.origin}/d/${data.id}`
      setLink(url)
      try {
        await navigator.clipboard.writeText(url)
        setCopied(true)
      } catch {
        // Clipboard unavailable — the link is shown below to copy by hand.
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="text-[13px] font-medium text-foreground/80 underline decoration-foreground/25 underline-offset-4 hover:text-foreground disabled:opacity-50"
      >
        {busy ? 'Preparing link…' : copied ? 'Share link copied' : 'Copy share link'}
      </button>
      {link && <p className={`break-all ${adminMetadataClass}`}>{link}</p>}
      {error && <p className="text-[13px] text-red-600">{error}</p>}
    </div>
  )
}
