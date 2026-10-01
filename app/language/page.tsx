import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getMyLanguagePreferences } from '@/lib/reading-language-data'
import { isInterfaceLocale, DEFAULT_LOCALE } from '@/i18n/config'
import LanguageOnboardingChooser from './language-onboarding-chooser'

export default async function LanguageOnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/sign-in')

  const [preference, requestLocale] = await Promise.all([
    getMyLanguagePreferences(supabase, user.id),
    getLocale(),
  ])

  // Existing/grandfathered or already-confirmed members never get held here.
  if (preference.ok && preference.confirmed) redirect('/')

  const suggested = isInterfaceLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE

  return <LanguageOnboardingChooser suggestedLocale={suggested} />
}
