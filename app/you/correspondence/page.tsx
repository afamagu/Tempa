import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getMyWritingRhythm } from '@/lib/writing-rhythm'
import {
  pageTitleClass,
  helperTextClass,
  secondaryButtonClass,
} from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import RhythmEditor from './rhythm-editor'

export default async function CorrespondenceSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, onboarding_stage')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) redirect('/profile')
  if (profile.onboarding_stage === 'mark') redirect('/profile/mark')
  if (profile.onboarding_stage === 'question') redirect('/profile/question')

  const [waitingCount, rhythmState] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getMyWritingRhythm(supabase),
  ])

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-2xl space-y-8 py-4 sm:py-8">
          <div className="space-y-3">
            <Link href="/you" className={secondaryButtonClass}>You</Link>
            <h1 className={pageTitleClass}>Correspondence</h1>
            <p className={helperTextClass}>
              Your usual rhythm helps another person understand the pace you naturally keep. It is not a deadline, a promise to reply on a particular day, or a score.
            </p>
            {!rhythmState?.rhythm && (
              <p className={helperTextClass}>
                You have not chosen a rhythm yet. Until you do, Tempa will not treat a gap in your replies as being beyond your usual pace.
              </p>
            )}
          </div>

          <RhythmEditor initialRhythm={rhythmState?.rhythm ?? null} />

          <p className={helperTextClass}>
            You can use a different rhythm with one correspondent from that correspondence itself. Changing your usual rhythm here does not overwrite those individual choices.
          </p>
        </div>
      </main>
    </AppShell>
  )
}
