import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getProfileInterestKeys } from '@/lib/profile-interests'
import { sectionLabelClass, proseSubheadingClass, helperTextClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import InterestsEditor from './interests-editor'

/**
 * Board Personalization Phase 2B — You / Settings → Reading interests,
 * the ONLY place (besides onboarding itself) a member can change what
 * shapes their Board relevance. Deliberately named "Reading interests"
 * throughout, never a bare "Interests" — that word already means
 * profiles.intent on the public profile (app/minds/[userId]/
 * interests-disclosure.tsx), a separate, unrelated concept. This page's
 * selections are NEVER shown on any profile.
 */
export default async function ReadingInterestsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const [waitingCount, selectedKeys] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getProfileInterestKeys(supabase, user.id),
  ])

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center p-6">
        <div className="w-full max-w-2xl space-y-6 py-10">
          <div className="space-y-1">
            <p className={sectionLabelClass}>You / Settings</p>
            <h1 className={proseSubheadingClass}>Reading interests</h1>
            <p className={helperTextClass}>
              What you love reading about — this shapes what The Board surfaces for you. It&rsquo;s
              never shown on your profile, and you can leave it empty any time.
            </p>
          </div>

          <InterestsEditor initialSelectedKeys={selectedKeys} />
        </div>
      </main>
    </AppShell>
  )
}
