'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { secondaryButtonClass } from '@/app/profile/ui'

export default function RestoreRoomLetterAction({ letterId }: { letterId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function restore() {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const { error } = await createClient().rpc('restore_my_room_letter', { p_letter_id: letterId })
      if (error) {
        setMessage('This letter could not be restored. It may no longer be eligible.')
        return
      }
      router.refresh()
    } catch {
      setMessage('Could not restore your letter. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return <div className="space-y-3">
    <button type="button" className={secondaryButtonClass} disabled={busy}
      onClick={() => void restore()}>
      {busy ? 'Restoring…' : 'Leave this letter in The Room again'}
    </button>
    <p className="text-[12px] text-foreground/60">
      It will be visible to Tempa members only. Old share links remain revoked.
    </p>
    {message && <p role="alert" className="text-[13px] text-red-700">{message}</p>}
  </div>
}
