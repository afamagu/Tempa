'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { primaryButtonClass, inputClass } from '@/app/profile/ui'

export default function MentionEmailPreference({ initialAudience }: { initialAudience: string }) {
  const t = useTranslations('MentionEmails')
  const [audience, setAudience] = useState(initialAudience)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<'saved' | 'failed' | null>(null)
  async function save() {
    if (busy) return
    setBusy(true); setResult(null)
    try {
      const { error } = await createClient().rpc('set_mention_email_preference', { p_audience: audience })
      setResult(error ? 'failed' : 'saved')
    } catch { setResult('failed') } finally { setBusy(false) }
  }
  return <section id="mention-emails" className="space-y-3 rounded-xl border border-accent/20 bg-accent/5 p-5">
    <h2 className="font-serif text-xl">{t('heading')}</h2>
    <p className="text-sm leading-relaxed text-foreground/75">{t('help')}</p>
    <label className="block space-y-2 text-sm"><span>{t('label')}</span>
      <select className={inputClass} value={audience} disabled={busy} onChange={event => { setAudience(event.target.value); setResult(null) }}>
        <option value="everyone">{t('everyone')}</option><option value="correspondents">{t('correspondents')}</option><option value="off">{t('off')}</option>
      </select>
    </label>
    <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => void save()}>{t(busy ? 'saving' : 'save')}</button>
    {result && <p role="status" className="text-sm">{t(result)}</p>}
  </section>
}
