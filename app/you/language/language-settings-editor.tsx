'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { INTERFACE_LOCALES, type InterfaceLocale } from '@/i18n/config'
import { readingLanguage } from '@/lib/reading-languages'
import { cardClass, helperTextClass, primaryButtonClass, sectionLabelClass, tertiaryButtonClass, quietLinkClass } from '@/app/profile/ui'
import ReadingLanguagePicker from '@/app/reading-language-picker'
import { chooseTempaLanguage } from '@/app/locale-actions'
import { saveReadingLanguage } from '@/app/reading-language-actions'

type Status = 'idle' | 'saved' | 'error'

/**
 * Primary: Tempa language (four interface languages). Choosing one sets the
 * interface cookie AND the same reading language, then the page re-renders
 * in the new language in place.
 *
 * Secondary: Translation language (108-language registry). Changing it
 * saves only the reading language; the interface stays as it is.
 */
export default function LanguageSettingsEditor({
  currentLocale,
  readingLanguage: readingCode,
  readingLanguageLoadFailed,
}: {
  currentLocale: InterfaceLocale
  readingLanguage: string | null
  readingLanguageLoadFailed: boolean
}) {
  const t = useTranslations('LanguageSettings')
  const [pending, startTransition] = useTransition()
  const [primaryStatus, setPrimaryStatus] = useState<Status>('idle')
  const [translationStatus, setTranslationStatus] = useState<Status>('idle')
  // Local echo of a successful save, until the server re-render lands.
  const [savedReading, setSavedReading] = useState<string | null | undefined>(undefined)
  const [editingTranslation, setEditingTranslation] = useState(false)
  const [chosenReading, setChosenReading] = useState<string | null>(null)

  const effectiveReading = savedReading !== undefined ? savedReading : readingCode
  const reading = readingLanguage(effectiveReading)

  function choosePrimary(code: InterfaceLocale) {
    if (code === currentLocale) return
    setPrimaryStatus('idle')
    startTransition(async () => {
      const result = await chooseTempaLanguage(code)
      if (result.ok) {
        setSavedReading(code)
        setPrimaryStatus('saved')
      } else {
        setPrimaryStatus('error')
      }
    })
  }

  function saveTranslation(code: string) {
    setTranslationStatus('idle')
    startTransition(async () => {
      const result = await saveReadingLanguage(code)
      if (result.ok) {
        setSavedReading(result.code)
        setTranslationStatus('saved')
        setEditingTranslation(false)
      } else {
        setTranslationStatus('error')
      }
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

      <section className="space-y-3 border-t border-foreground/10 pt-6" aria-labelledby="translation-language-label">
        <div className="space-y-1">
          <p id="translation-language-label" className={sectionLabelClass}>
            {t('translationHeading')}
          </p>
          <p className={helperTextClass}>{t('translationIntro')}</p>
        </div>

        {readingLanguageLoadFailed && savedReading === undefined ? (
          <div className="space-y-3 rounded-md border border-foreground/10 p-4">
            <p className="text-sm text-red-600">{t('loadError')}</p>
            <a href="/you/language" className={quietLinkClass}>
              {t('tryAgain')}
            </a>
          </div>
        ) : editingTranslation ? (
          <div className="space-y-4">
            <ReadingLanguagePicker
              value={chosenReading ?? effectiveReading ?? null}
              onSelect={(code) => {
                setChosenReading(code)
                setTranslationStatus('idle')
              }}
              disabled={pending}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                disabled={pending || !chosenReading || chosenReading === effectiveReading}
                onClick={() => chosenReading && saveTranslation(chosenReading)}
              >
                {pending ? t('saving') : t('save')}
              </button>
              <button
                type="button"
                className={tertiaryButtonClass}
                disabled={pending}
                onClick={() => {
                  setEditingTranslation(false)
                  setChosenReading(null)
                }}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[15px] text-foreground">
              {!reading
                ? t('notChosen')
                : reading.code === currentLocale
                  ? t('sameAsTempa')
                  : t.rich('currentTranslation', {
                      language: () => (
                        <span lang={reading.code} dir={reading.direction}>
                          {reading.nativeName}
                        </span>
                      ),
                    })}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <button type="button" className={quietLinkClass} disabled={pending} onClick={() => setEditingTranslation(true)}>
                {t('chooseDifferent')}
              </button>
              {reading?.code !== currentLocale && (
                <button type="button" className={quietLinkClass} disabled={pending} onClick={() => saveTranslation(currentLocale)}>
                  {t('useTempaLanguage')}
                </button>
              )}
            </div>
          </div>
        )}

        {translationStatus === 'saved' && <p className={helperTextClass}>{t('saved')}</p>}
        {translationStatus === 'error' && <p className="text-sm text-red-600">{t('error')}</p>}
      </section>
    </div>
  )
}
