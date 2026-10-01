'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { primaryButtonClass } from '@/app/profile/ui'

export default function RoomInvitationPreference({ initialEnabled }: { initialEnabled: boolean }) {
  const t = useTranslations('RoomInvitations')
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  async function save() {
    setPending(true); setMessage(null)
    try {
      const { error } = await createClient().rpc('set_room_invitation_email_preference', { p_enabled: enabled })
      setMessage(t(error ? 'failed' : 'saved'))
    } catch { setMessage(t('failed')) }
    setPending(false)
  }
  return <section className="space-y-3 border-t border-foreground/10 pt-5">
    <label className="flex items-center justify-between gap-4 rounded-md border border-foreground/10 p-3 text-sm"><span>{t('emailPreference')}</span><input type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); setMessage(null) }} /></label>
    <button className={primaryButtonClass} type="button" disabled={pending} onClick={save}>{t(pending ? 'saving' : 'save')}</button>
    {message && <p role="status" className="text-sm text-foreground/65">{message}</p>}
  </section>
}
