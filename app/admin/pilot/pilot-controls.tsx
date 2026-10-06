'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { invitePilotEmail, revokePilotInvite } from '@/lib/admin-pilot'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'

export function PilotInviteForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function submit() {
    if (busy || !email.trim()) return
    setBusy(true)
    setMessage(null)
    const result = await invitePilotEmail(createClient(), email, note)
    setBusy(false)

    if (result.error) {
      setMessage(result.error)
      return
    }

    setEmail('')
    setNote('')
    setMessage('Invitation ready.')
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="invite@example.com"
          className={inputClass}
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Optional note"
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !email.trim()}
          className={primaryButtonClass}
        >
          {busy ? 'Adding…' : 'Add invite'}
        </button>
      </div>
      {message && <p role="status" className="text-[13px] text-muted">{message}</p>}
    </div>
  )
}

export function RevokePilotInviteButton({ inviteId }: { inviteId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm('Revoke this pending pilot invitation?')) return
        setBusy(true)
        await revokePilotInvite(createClient(), inviteId)
        setBusy(false)
        router.refresh()
      }}
      className={secondaryButtonClass}
    >
      {busy ? 'Revoking…' : 'Revoke'}
    </button>
  )
}
