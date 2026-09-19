'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { sendAdminFirstLetter } from '@/lib/admin'
import { fieldLabelClass, inputClass, primaryButtonClass } from '@/app/profile/ui'

export default function AdminContactMember({ memberId }: { memberId: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    const trimmed = body.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    const result = await sendAdminFirstLetter(createClient(), memberId, trimmed)
    setBusy(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    setBody('')
    router.refresh()
  }

  return (
    <div className="space-y-3 rounded-md border border-foreground/10 p-4">
      <label htmlFor="admin-member-letter" className={fieldLabelClass}>Write to this member</label>
      <textarea
        id="admin-member-letter"
        value={body}
        onChange={(event) => setBody(event.target.value.slice(0, 4000))}
        rows={5}
        maxLength={4000}
        className={inputClass}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="button" onClick={send} disabled={busy || body.trim().length === 0} className={primaryButtonClass}>
        {busy ? 'Sending…' : 'Send letter'}
      </button>
    </div>
  )
}
