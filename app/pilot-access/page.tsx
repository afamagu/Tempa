import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signOutAndReturnToSignIn } from '@/app/begin/sign-out-action'
import { pageTitleClass, secondaryButtonClass, systemBodyClass } from '@/app/profile/ui'

export const metadata = {
  title: 'Founding Correspondents — Tempa',
  robots: { index: false, follow: false },
}

/**
 * Phase 16 controlled-pilot boundary. This route is intentionally outside
 * proxy.ts's protected matcher so an uninvited authenticated account can
 * render it without a redirect loop. It re-checks the server-authoritative
 * pilot RPC itself and sends an invited/grandfathered member back through
 * the normal protected-route gate.
 */
export default async function PilotAccessPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/sign-in')

  const { data: hasPilotAccess, error } = await supabase.rpc('current_pilot_access')

  // Before the migration exists, fail open exactly like the proxy helper so
  // deploy ordering cannot lock out existing members.
  if (error) redirect('/home')
  if (hasPilotAccess === true) redirect('/home')

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-md space-y-6">
        <p className="font-serif text-lg italic text-foreground">Tempa</p>
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-clay">Founding Correspondents</p>
          <h1 className={pageTitleClass}>Tempa is in a small, invitation-only pilot.</h1>
          <p className={systemBodyClass}>
            We&rsquo;re keeping the first cohort deliberately small while we watch how real correspondence develops and fix what needs fixing.
          </p>
          <p className={systemBodyClass}>
            If you were invited, sign in with the same email address that received the invitation.
          </p>
        </div>
        <form action={signOutAndReturnToSignIn}>
          <button type="submit" className={secondaryButtonClass}>Sign out</button>
        </form>
      </div>
    </main>
  )
}
