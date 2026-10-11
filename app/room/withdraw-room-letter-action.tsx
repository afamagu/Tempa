'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { helperTextClass, secondaryButtonClass } from '@/app/profile/ui'

/** Withdraw a public member letter without touching any private correspondence. */
export default function WithdrawRoomLetterAction({ letterId }: { letterId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function withdraw() {
    if (working) return
    setWorking(true)
    setError(null)
    try {
      const { error: rpcError } = await createClient()
        .rpc('withdraw_my_room_letter', { p_letter_id: letterId })
      if (rpcError) {
        setError('We could not withdraw this letter. Please try again.')
        return
      }
      router.replace('/room')
      router.refresh()
    } catch {
      setError('Your letter could not be withdrawn. Please try again.')
    } finally {
      setWorking(false)
    }
  }

  if (!confirming) {
    return <button type="button" onClick={() => setConfirming(true)}
      className={secondaryButtonClass}>
      Withdraw from The Room
    </button>
  }

  return <div className="space-y-3 rounded-md border border-foreground/15 bg-surface-shell p-3">
    <p className="text-sm font-medium">Withdraw this letter?</p>
    <p className={helperTextClass}>
      This will remove it from public discovery and make existing share links
      unavailable. Private letters already exchanged will remain.
    </p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={working} className={secondaryButtonClass}
        onClick={() => setConfirming(false)}>Cancel</button>
      <button type="button" disabled={working}
        className="rounded-md border border-red-700/35 px-3 py-2 text-sm text-red-700 disabled:opacity-60"
        onClick={() => void withdraw()}>{working ? 'Withdrawing…' : 'Yes, withdraw'}</button>
    </div>
  </div>
}
