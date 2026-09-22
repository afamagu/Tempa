import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getArrivalEmailPreference } from '@/lib/email-preferences'
import { proseSubheadingClass, helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import NotificationsEditor from './notifications-editor'

export default async function NotificationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const [waitingCount, enabled] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getArrivalEmailPreference(supabase, user.id),
  ])

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center p-6">
        <div className="w-full max-w-2xl space-y-6 py-10">
          <div className="space-y-2">
            <Link href="/you" className={secondaryButtonClass}>
              You
            </Link>
            <h1 className={proseSubheadingClass}>Notifications</h1>
            <p className={helperTextClass}>
              Choose whether Tempa emails you when a letter arrives in your Letterbox.
            </p>
          </div>

          <NotificationsEditor initialEnabled={enabled} />
        </div>
      </main>
    </AppShell>
  )
}
