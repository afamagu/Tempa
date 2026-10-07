import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { proseSubheadingClass, helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import LanguageSettingsEditor from './language-settings-editor'

/**
 * You → Language. A member makes ONE choice: the language they use on
 * Tempa. It sets Tempa's interface language on this device (tempa_locale
 * cookie, dictionary-based) and keeps the same value as the underlying
 * reading-language default for future member-facing translation.
 *
 * The advanced translation-language override remains hidden until translation
 * is actually available on a member reading surface. Never inferred from country.
 */
export default async function LanguagePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/profile')

  const [waitingCount, locale, t] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
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

          <LanguageSettingsEditor currentLocale={locale} />
        </div>
      </main>
    </AppShell>
  )
}
