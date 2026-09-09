'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { blockUser, unblockUser, type BlockScope } from '@/lib/blocking'
import { secondaryButtonClass, destructiveButtonClass } from '@/app/profile/ui'

/**
 * De-escalating (Unblock) — no confirmation step, matching Checkpoint
 * 1B's own "unblock remains a simple, available action" design.
 * Unblocking never restores a Keep relationship a full block removed.
 *
 * Checkpoint 1C: a 'letters' row also offers "Block everywhere" as an
 * in-place upgrade (the same escalation app/block-button.tsx offers
 * inline elsewhere), so this management screen has an obvious way to
 * move a letters-only block to a full block without re-visiting the
 * member's profile.
 */
export default function UnblockButton({ blockedId, scope }: { blockedId: string; scope: BlockScope }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUnblock() {
    if (busy) return
    setBusy(true)
    setError(null)

    const { error: unblockError } = await unblockUser(createClient(), blockedId)

    setBusy(false)

    if (unblockError) {
      setError('Could not unblock. Please try again.')
      return
    }

    router.refresh()
  }

  async function handleBlockEverywhere() {
    if (busy) return
    setBusy(true)
    setError(null)

    const { error: blockError } = await blockUser(createClient(), blockedId, 'full')

    setBusy(false)

    if (blockError) {
      setError('Could not update this block. Please try again.')
      return
    }

    router.refresh()
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={handleUnblock} disabled={busy} className={secondaryButtonClass}>
          {busy ? 'Working…' : scope === 'letters' ? 'Restore letters' : 'Unblock'}
        </button>
        {scope === 'letters' && (
          <button type="button" onClick={handleBlockEverywhere} disabled={busy} className={destructiveButtonClass}>
            Block everywhere
          </button>
        )}
      </div>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
    </div>
  )
}
