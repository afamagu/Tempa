'use client'

import { useId, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { INTERFACE_LOCALES, isInterfaceLocale } from '@/i18n/config'
import { setInterfaceLanguage } from '@/app/locale-actions'

/**
 * A quiet interface-language control ("English ▾") for surfaces a person
 * sees before signing in. A native <select>: fully keyboard and screen-
 * reader accessible, the platform's own picker on phones, no flags.
 *
 * Choosing only sets the tempa_locale cookie through a Server Action; the
 * page re-renders in place at the same URL. It is outside any <form>, so it
 * can never submit one.
 */
export default function LanguageSwitcher({ className = '' }: { className?: string }) {
  const locale = useLocale()
  const t = useTranslations('LanguageSwitcher')
  const id = useId()
  const [pending, startTransition] = useTransition()

  return (
    <div className={`relative inline-flex items-center ${className}`.trim()}>
      <label htmlFor={id} className="sr-only">
        {t('label')}
      </label>
      <select
        id={id}
        value={locale}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value
          if (!isInterfaceLocale(next) || next === locale) return
          startTransition(async () => {
            await setInterfaceLanguage(next)
          })
        }}
        className="appearance-none rounded-md border border-foreground/12 bg-transparent py-1.5 pl-3 pr-7 text-[13px] text-foreground/75 transition-colors hover:border-foreground/25 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-60"
      >
        {INTERFACE_LOCALES.map((option) => (
          <option key={option.code} value={option.code} lang={option.code}>
            {option.nativeName}
          </option>
        ))}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-2.5 text-[10px] text-muted">
        ▾
      </span>
    </div>
  )
}
