import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyAccountStatus } from '@/lib/account-status'
import { signOutAndReturnToSignIn } from '@/app/begin/sign-out-action'
import { pageTitleClass, secondaryButtonClass, systemBodyClass } from '@/app/profile/ui'

export const metadata = { title: 'Account unavailable — Tempa' }

const FALLBACK_BODY =
  'After reviewing activity on your account, we have made a permanent decision that it can no longer be used on Tempa.\n\nThis decision was made by a person on the Tempa team, not automatically.'

/**
 * Where a permanently-banned account lands. proxy.ts sends every
 * protected route here for a banned member, so there is nothing else for
 * them to open: no profile, no correspondence, no writing. The wording is
 * the official "From Tempa" notice stored when the decision was made
 * (public.member_notices, read through the member's own RLS), with a
 * fixed fallback if none exists. The account, its evidence and its
 * sign-in identity are retained (not deleted) — this only stops use.
 * A member whose account is NOT banned is sent back to /home, so this
 * page can never be used to discover another account's state.
 */
export default async function AccountUnavailablePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const status = await getMyAccountStatus(supabase)
  if (status !== 'banned') {
    redirect('/home')
  }

  const { data: notice } = await supabase
    .from('member_notices')
    .select('title, body')
    .eq('kind', 'permanent_decision')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const title = notice?.title ?? 'A quick note from Tempa'
  const body = notice?.body ?? FALLBACK_BODY

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-clay">From Tempa</p>
        <h1 className={pageTitleClass}>Account unavailable</h1>
        <div className="space-y-3 border-l-2 border-clay/50 pl-3">
          <h2 className="text-[15px] font-medium text-foreground">{title}</h2>
          {body.split('\n\n').map((paragraph: string) => (
            <p key={paragraph} className={systemBodyClass}>
              {paragraph}
            </p>
          ))}
        </div>
        <form action={signOutAndReturnToSignIn}>
          <button type="submit" className={secondaryButtonClass}>
            Sign out
          </button>
        </form>
      </div>
    </main>
  )
}
