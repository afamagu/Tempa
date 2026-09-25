import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signOutAndReturnToSignIn } from '@/app/begin/sign-out-action'
import { helperTextClass, pageTitleClass, secondaryButtonClass, sectionLabelClass, systemBodyClass } from '@/app/profile/ui'
import DeleteAccountPanel from '@/app/you/account/delete-account-panel'
import ReturnToTempaButton from './return-to-tempa-button'

export const metadata = { title: 'Your Tempa is waiting', robots: { index: false, follow: false } }

/**
 * Where a member who is taking a break lands (proxy.ts sends every
 * protected route here). Signing in never reactivates on its own: only
 * "Return to Tempa" does, explicitly. Permanent deletion stays available
 * from here. Not a proxy-matched route, so it checks state itself.
 */
export default async function AccountPausedPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const { data: lifecycle } = await supabase.rpc('my_account_lifecycle')
  if (lifecycle === 'closed') redirect('/account-deleted')
  if (lifecycle !== 'deactivated') redirect('/home')

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8 py-10">
        <div className="space-y-5">
          <p className="font-serif text-lg italic text-foreground">Tempa</p>
          <h1 className={pageTitleClass}>Your Tempa is waiting.</h1>
          <p className={systemBodyClass}>
            You&rsquo;re taking a break. Your letters, Keepsakes and account are all still here, just as you left
            them. Your profile and Dispatches return the moment you come back.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ReturnToTempaButton />
            <form action={signOutAndReturnToSignIn}>
              <button type="submit" className={secondaryButtonClass}>
                Sign out
              </button>
            </form>
          </div>
        </div>

        <section className="space-y-3 border-t border-foreground/10 pt-6">
          <p className={sectionLabelClass}>Delete account</p>
          <p className={helperTextClass}>
            If you&rsquo;d rather leave Tempa for good, you can permanently delete your account instead.
          </p>
          <DeleteAccountPanel />
        </section>
      </div>
    </main>
  )
}
