'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { INTERFACE_LOCALES, type InterfaceLocale } from '@/i18n/config'
import { cardClass, helperTextClass, sectionLabelClass } from '@/app/profile/ui'
import { chooseTempaLanguage } from '@/app/locale-actions'

type Status = 'idle' | 'saved' | 'error'

/**
 * Tempa language (four reviewed interface languages). Choosing one sets the
 * interface cookie and keeps the same value as the member's underlying
 * reading-language default for future translation surfaces.
 *
 * The separate Translation-language override stays hidden until a real
 * member-facing translation action ships; settings should not advertise a
 * capability that cannot yet be used.
 */
export default function LanguageSettingsEditor({
  currentLocale,
}: {
  currentLocale: InterfaceLocale
}) {
  const t = useTranslations('LanguageSettings')
  const [pending, startTransition] = useTransition()
  const [primaryStatus, setPrimaryStatus] = useState<Status>('idle')

  function choosePrimary(code: InterfaceLocale) {
    if (code === currentLocale) return
    setPrimaryStatus('idle')
    startTransition(async () => {
      const result = await chooseTempaLanguage(code)
      setPrimaryStatus(result.ok ? 'saved' : 'error')
    })
  }

  return (
    <div className="space-y-10">
      <section className="space-y-3" aria-labelledby="tempa-language-label">
        <p id="tempa-language-label" className={sectionLabelClass}>
          {t('optionsLabel')}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {INTERFACE_LOCALES.map((option) => {
            const selected = option.code === currentLocale
            return (
              <button
                key={option.code}
                type="button"
                aria-pressed={selected}
                disabled={pending}
                onClick={() => choosePrimary(option.code)}
                className={`${cardClass(selected)} flex items-center justify-between gap-3 disabled:opacity-60`}
              >
                <span lang={option.code} className="text-[15px] text-foreground">
                  {option.nativeName}
                </span>
                {selected && <span className="text-[13px] text-muted">{t('current')}</span>}
              </button>
            )
          })}
        </div>
        {pending && primaryStatus === 'idle' && <p className={helperTextClass}>{t('saving')}</p>}
        {primaryStatus === 'saved' && <p className={helperTextClass}>{t('saved')}</p>}
        {primaryStatus === 'error' && <p className="text-sm text-red-600">{t('error')}</p>}
      </section>
    </div>
  )
}
