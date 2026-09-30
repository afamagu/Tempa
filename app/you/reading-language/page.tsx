import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getMyReadingLanguage } from '@/lib/reading-language-data'
import { proseSubheadingClass, helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import ReadingLanguageEditor from './reading-language-editor'

/**
 * You → Reading language. A private preference: the language Tempa uses
 * when this member chooses to translate someone else's writing. Never
 * required, never part of onboarding, never inferred from country, and never
 * shown to anyone else. Tempa's own interface language is a separate,
 * future setting (docs/reading-language.md).
 */
export default async function ReadingLanguagePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/profile')

  const [waitingCount, preference] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getMyReadingLanguage(supabase, user.id),
  ])

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center p-6">
        <div className="w-full max-w-2xl space-y-6 py-10">
          <div className="space-y-2">
            <Link href="/you" className={secondaryButtonClass}>
              You
            </Link>
            <h1 className={proseSubheadingClass}>Reading language</h1>
            <p className={helperTextClass}>
              Choose the language Tempa should use when you translate someone&rsquo;s writing. This does not change
              Tempa&rsquo;s menus or what anyone originally wrote.
            </p>
          </div>

          {preference.ok ? (
            <ReadingLanguageEditor initialCode={preference.code} />
          ) : (
            <div className="space-y-3 rounded-md border border-foreground/10 p-4">
              <p className="text-sm text-red-600">Could not load your reading language right now. Please try again.</p>
              <a href="/you/reading-language" className={secondaryButtonClass}>
                Try again
              </a>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}
