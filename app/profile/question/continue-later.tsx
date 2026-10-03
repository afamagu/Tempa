'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { continueWithoutIntroduction } from './continue-later-action'
import { helperTextClass, secondaryButtonClass } from '@/app/profile/ui'

export default function ContinueLater({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const router = useRouter()
  const t = useTranslations('Introduction')
  async function proceed() {
    if (busy || disabled) return
    setBusy(true)
    setFailed(false)
    try {
      const result = await continueWithoutIntroduction()
      if (!result.ok) { setFailed(true); return }
      router.push('/home')
      router.refresh()
    } catch { setFailed(true) }
    finally { setBusy(false) }
  }
  return <div className="space-y-3 rounded-lg border border-foreground/10 p-4">
    <p className={helperTextClass}>{t('laterBody')}</p>
    <button type="button" disabled={disabled || busy} onClick={() => void proceed()} className={secondaryButtonClass}>
      {busy ? t('working') : t('later')}
    </button>
    {failed && <p role="alert" className="text-sm text-red-600">{t('continueError')}</p>}
  </div>
}
