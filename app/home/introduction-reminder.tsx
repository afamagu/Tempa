'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { introductionReminderCookie, INTRODUCTION_SNOOZE_MS } from '@/lib/introduction-reminder'
import { helperTextClass, quietLinkClass } from '@/app/profile/ui'

export default function IntroductionReminder({ userId, questionId }: { userId: string; questionId: string }) {
  const [dismissed, setDismissed] = useState(false)
  const t = useTranslations('Introduction')
  if (dismissed) return null

  function snooze() {
    document.cookie = `${introductionReminderCookie(userId)}=${Date.now() + INTRODUCTION_SNOOZE_MS}; Path=/; Max-Age=86400; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
    setDismissed(true)
  }

  return <aside className="mb-8 space-y-3 rounded-lg border border-clay/20 bg-clay/[.04] p-4" aria-label={t('title')}>
    <p className="font-serif text-lg text-foreground">{t('title')}</p>
    <p className={helperTextClass}>{t('body')}</p>
    <div className="flex flex-wrap items-center gap-4">
      <Link href={`/question/${questionId}`} className={quietLinkClass}>{t('answer')}</Link>
      <button type="button" onClick={snooze} className={helperTextClass}>{t('notNow')}</button>
    </div>
  </aside>
}
