import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import { sectionLabelClass, proseSubheadingClass, helperTextClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import Mindform from '@/app/mindform'

export default async function YouPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase
    .from('profiles')
    .select('pseudonym, mark_id')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) redirect('/profile')

  const waitingCount = await getWaitingLetterCount(supabase, user.id)
  const markUrl = profile.mark_id ? publicProfileMarkUrl(supabase, `${profile.mark_id}.png`) : null

  async function signOut() {
    'use server'
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/sign-in')
  }

  const actionClass = 'inline-flex items-center justify-center rounded-md border border-foreground/15 px-4 py-2.5 text-[15px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]'

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-8 py-10">
          <div className="space-y-4">
            <p className={sectionLabelClass}>You</p>
            <div className="flex items-center gap-5">
              {markUrl ? (
                <div role="img" aria-label="Your Mark" className="h-28 w-28 shrink-0 rounded-full border border-foreground/10 bg-cover bg-center shadow-sm sm:h-32 sm:w-32" style={{ backgroundImage: `url(${markUrl})` }} />
              ) : (
                <Mindform identifier={user.id} size="lg" />
              )}
              <div className="min-w-0">
                <h1 className={proseSubheadingClass}>{profile.pseudonym}</h1>
                {markUrl ? <p className={`mt-1 ${helperTextClass}`}>Your Mark</p> : <p className={`mt-1 ${helperTextClass}`}>Your Mark has not been created yet.</p>}
              </div>
            </div>
          </div>

          <Link href={`/minds/${user.id}`} className={actionClass}>View your profile</Link>
          <Link href="/you/responses" className={actionClass}>Your responses</Link>
          <Link href="/you/keepsakes" className={actionClass}>Keepsakes</Link>
          <Link href="/you/interests" className={actionClass}>Reading interests</Link>
          <Link href="/you/guide" className={actionClass}>Tempa Guide</Link>
          <Link href="/you/safety/blocked-minds" className={actionClass}>Blocked minds</Link>
          <form action={signOut}><button type="submit" className={actionClass}>Sign out</button></form>
        </div>
      </main>
    </AppShell>
  )
}
