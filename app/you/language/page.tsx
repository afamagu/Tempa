import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getMyReadingLanguage } from '@/lib/reading-language-data'
import { proseSubheadingClass, helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import LanguageSettingsEditor from './language-settings-editor'

/**
 * You → Language. A member makes ONE choice: the language they use on
 * Tempa. It sets Tempa's interface language on this device (tempa_locale
 * cookie, dictionary-based) and becomes their default translation language
 * (member_language_preferences.reading_language, via the existing
 * set_my_reading_language path). Beneath it, a quiet "Translation language"
 * lets someone who wants Tempa in one language but translations in another
 * pick from the full Reading language registry.
 *
 * Never required, never onboarding, never inferred from country.
 */
export default async function LanguagePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/profile')

  const [waitingCount, preference, locale, t] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getMyReadingLanguage(supabase, user.id),
    getLocale(),
    getTranslations('LanguageSettings'),
  ])

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center p-6">
        <div className="w-full max-w-2xl space-y-6 py-10">
          <div className="space-y-2">
            <Link href="/you" className={secondaryButtonClass}>
              {t('back')}
            </Link>
            <h1 className={proseSubheadingClass}>{t('heading')}</h1>
            <p className={helperTextClass}>{t('intro')}</p>
          </div>

          <LanguageSettingsEditor
            currentLocale={locale}
            readingLanguage={preference.ok ? preference.code : null}
            readingLanguageLoadFailed={!preference.ok}
          />
        </div>
      </main>
    </AppShell>
  )
}
