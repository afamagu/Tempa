import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signOutAndReturnToSignIn } from '@/app/begin/sign-out-action'
import { pageTitleClass, secondaryButtonClass, systemBodyClass } from '@/app/profile/ui'

export const metadata = {
  title: 'Account access — Tempa',
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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-clay">Account access</p>
          <h1 className={pageTitleClass}>This email address is not approved for registration yet.</h1>
          <p className={systemBodyClass}>
            Tempa is currently welcoming new members gradually.
          </p>
          <p className={systemBodyClass}>
            If your email has been approved, sign out and continue with that address.
          </p>
        </div>
        <form action={signOutAndReturnToSignIn}>
          <button type="submit" className={secondaryButtonClass}>Sign out</button>
        </form>
      </div>
    </main>
  )
}
