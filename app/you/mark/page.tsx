import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfileMarkManagementStatus, publicProfileMarkUrl } from '@/lib/profile-marks'
import { formatDatePlain } from '@/lib/format-date'
import { helperTextClass, primaryButtonClass, quietLinkClass, sectionLabelClass } from '@/app/profile/ui'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import YourMarkStep from '@/app/profile/mark/your-mark-step'

export default async function ManageMarkPage({
  searchParams,
}: {
  searchParams: Promise<{ replace?: string }>
}) {
  const { replace } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase
    .from('profiles')
    .select('pseudonym, onboarding_stage, mark_id')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) redirect('/profile')
  if (profile.onboarding_stage === 'mark') redirect('/profile/mark')
  if (profile.onboarding_stage === 'question') redirect('/profile/question')

  const status = await getProfileMarkManagementStatus(supabase)
  const markId = status.markId ?? profile.mark_id ?? null
  const markUrl = markId ? publicProfileMarkUrl(supabase, `${markId}.png`) : null

  if (!markUrl || (replace === '1' && status.canChange)) {
    return <YourMarkStep destination="/you" continueLabel={markUrl ? 'Save new Mark' : 'Save your Mark'} />
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
      <div className="w-full max-w-md space-y-8 text-center">
        <p className={sectionLabelClass}>You / Your Mark</p>
        <ProfileIdentityMark identifier={user.id} markUrl={markUrl} label="Your Mark" size="xl" className="mx-auto" />
        <div className="space-y-3">
          <h1 className="font-serif text-3xl font-medium">Your Mark</h1>
          {status.canChange ? (
            <>
              <p className="text-[15px] leading-relaxed text-foreground/75">
                A Mark can be changed only once every 30 days. Choosing a new photograph will replace this Mark everywhere on Tempa.
              </p>
              <Link href="/you/mark?replace=1" className={primaryButtonClass}>Continue to choose a photograph</Link>
            </>
          ) : (
            <p className={helperTextClass}>
              You can change your Mark again{status.nextChangeAt ? ` on ${formatDatePlain(status.nextChangeAt)}` : ' after the 30-day waiting period'}.
            </p>
          )}
        </div>
        <Link href="/you" className={quietLinkClass}>Back to You</Link>
      </div>
    </main>
  )
}
