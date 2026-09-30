'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { chooseTempaLanguage } from '@/app/locale-actions'
import { INTERFACE_LOCALES, type InterfaceLocale } from '@/i18n/config'
import { cardClass, helperTextClass, primaryButtonClass } from '@/app/profile/ui'

export default function LanguageOnboardingChooser({
  suggestedLocale,
}: {
  suggestedLocale: InterfaceLocale
}) {
  const t = useTranslations('LanguageOnboarding')
  const [selected, setSelected] = useState<InterfaceLocale>(suggestedLocale)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState(false)

  function continueWithLanguage() {
    if (pending) return
    setError(false)
    startTransition(async () => {
      const result = await chooseTempaLanguage(selected)
      if (!result.ok) {
        setError(true)
        return
      }
      // A full navigation makes the newly persisted/cookie locale authoritative
      // for every subsequent Server Component in the onboarding journey.
      window.location.assign('/')
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6 sm:p-8">
      <div className="w-full max-w-lg space-y-8 py-10">
        <header className="space-y-3 text-center">
          <div aria-hidden="true" className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-foreground/12 text-xl">
            文
          </div>
          <p className="font-serif text-sm italic tracking-[0.18em] text-muted">Tempa</p>
          <h1 className="font-serif text-3xl font-medium">{t('heading')}</h1>
          <p className="text-[15px] leading-relaxed text-foreground/70">{t('intro')}</p>
        </header>

        <fieldset className="space-y-3">
          <legend className="sr-only">{t('heading')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {INTERFACE_LOCALES.map((locale) => {
              const isSelected = selected === locale.code
              return (
                <label
                  key={locale.code}
                  className={`${cardClass(isSelected)} flex cursor-pointer items-center justify-between gap-3`}
                >
                  <input
                    type="radio"
                    name="tempa-language"
                    value={locale.code}
                    checked={isSelected}
                    onChange={() => setSelected(locale.code)}
                    className="sr-only"
                  />
                  <span lang={locale.code} className="text-[17px] font-medium text-foreground">
                    {locale.nativeName}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 rounded-full ${isSelected ? 'bg-accent' : 'border border-foreground/20'}`}
                  />
                </label>
              )
            })}
          </div>
        </fieldset>

        <div className="space-y-3 text-center">
          {error && <p role="alert" className="text-sm text-red-600">{t('error')}</p>}
          <button
            type="button"
            onClick={continueWithLanguage}
            disabled={pending}
            className={`${primaryButtonClass} min-w-[11rem]`}
          >
            {pending ? t('saving') : t('continue')}
          </button>
          <p className={helperTextClass}>{t('changeLater')}</p>
        </div>
      </div>
    </main>
  )
}
