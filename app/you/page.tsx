import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getProfileMarkManagementStatus, publicProfileMarkUrl } from '@/lib/profile-marks'
import { formatDatePlain } from '@/lib/format-date'
import { sectionLabelClass, pageTitleClass, proseSubheadingClass, helperTextClass, quietLinkClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import { getMyWritingStyle } from '@/lib/writing-style-data'
import { WRITING_STYLES } from '@/lib/writing-style'
import { getMyWritingRhythm, writingRhythmLabel } from '@/lib/writing-rhythm'
import { getCreditBalance } from '@/lib/commerce'
import { getLocale, getTranslations } from 'next-intl/server'
import { localeNativeName } from '@/i18n/config'

const controlClass =
  'flex items-center justify-between gap-4 rounded-md border border-foreground/10 px-4 py-3 text-[15px] text-foreground transition-colors hover:border-foreground/25 hover:bg-foreground/[.02]'

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

  const [waitingCount, markStatus, writingStyleId, rhythmState, creditBalanceResult, locale, t] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getProfileMarkManagementStatus(supabase).catch(() => ({
      markId: profile.mark_id ?? null,
      canChange: profile.mark_id == null,
      nextChangeAt: null,
    })),
    getMyWritingStyle(supabase, user.id),
    getMyWritingRhythm(supabase),
    getCreditBalance(supabase),
    getLocale(),
    getTranslations('You'),
  ])
  const markId = markStatus.markId ?? profile.mark_id ?? null
  const markUrl = markId ? publicProfileMarkUrl(supabase, `${markId}.png`) : null
  const rhythmLabel = writingRhythmLabel(rhythmState?.rhythm ?? null, locale)
  const creditBalance = creditBalanceResult.data ?? 0

  async function signOut() {
    'use server'
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/sign-in?signed_out=1')
  }

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-2xl space-y-10 py-4 sm:py-8">
          <header className="space-y-6">
            <h1 className={pageTitleClass}>You</h1>
            <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
              <ProfileIdentityMark
                identifier={user.id}
                markUrl={markUrl}
                label={markUrl ? 'Your Mark' : undefined}
                size="xl"
              />
              <div className="min-w-0 space-y-2">
                <h2 className={proseSubheadingClass}>{profile.pseudonym}</h2>
                {markUrl ? (
                  <>
                    <p className={helperTextClass}>Your Mark</p>
                    <Link href="/you/mark" className={quietLinkClass}>Manage your Mark</Link>
                    {!markStatus.canChange && markStatus.nextChangeAt && (
                      <p className={helperTextClass}>
                        You can change it again on {formatDatePlain(markStatus.nextChangeAt)}.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className={helperTextClass}>You have not created your Mark yet.</p>
                    <Link href="/you/mark" className={quietLinkClass}>Create your Mark</Link>
                  </>
                )}
              </div>
            </div>
          </header>

          <section className="space-y-3">
            <p className={sectionLabelClass}>Your presence</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Link href={`/minds/${user.id}`} className={controlClass}><span>View your profile</span><span aria-hidden>→</span></Link>
              <Link href="/you/archive" className={controlClass}><span>Your archive</span><span aria-hidden>→</span></Link>
              <Link href="/you/correspondence" className={controlClass}>
                <span>Correspondence</span>
                <span className="flex items-center gap-2">
                  <span className="text-right text-[13px] text-muted">{rhythmLabel ?? 'Choose your rhythm'}</span>
                  <span aria-hidden>→</span>
                </span>
              </Link>
              <Link href="/you/writing-style" className={controlClass}>
                <span>Writing style</span>
                <span className="flex items-center gap-2">
                  {writingStyleId && <span className="text-[13px] text-muted">{WRITING_STYLES[writingStyleId].name}</span>}
                  <span aria-hidden>→</span>
                </span>
              </Link>
              <Link href="/you/language" className={controlClass}>
                <span>{t('language')}</span>
                <span className="flex items-center gap-2">
                  <span lang={locale} className="text-[13px] text-muted">{localeNativeName(locale)}</span>
                  <span aria-hidden>→</span>
                </span>
              </Link>
              <Link href="/you/interests" className={controlClass}><span>Reading interests</span><span aria-hidden>→</span></Link>
              <Link
                href="/you/credits"
                className={`${controlClass} border-accent/25 bg-accent/[.04]`}
              >
                <span className="font-semibold">Credits</span>
                <span className="flex items-center gap-2">
                  <span className="text-right text-[13px] text-muted">{creditBalance.toLocaleString()} available</span>
                  <span aria-hidden>→</span>
                </span>
              </Link>
              <Link href="/you/postcards" className={controlClass}><span>Postcards</span><span aria-hidden>→</span></Link>
              <Link href="/you/keepsakes" className={controlClass}><span>Keepsakes</span><span aria-hidden>→</span></Link>
              <Link href="/you/notifications" className={controlClass}><span>Notifications</span><span aria-hidden>→</span></Link>
            </div>
          </section>

          <section className="space-y-3">
            <p className={sectionLabelClass}>Tempa</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Link href="/you/guide" className={controlClass}><span>Tempa Guide</span><span aria-hidden>→</span></Link>
              <Link href="/you/safety/blocked-minds" className={controlClass}><span>Blocked members</span><span aria-hidden>→</span></Link>
              <Link href="/you/account" className={controlClass}><span>Account &amp; privacy</span><span aria-hidden>→</span></Link>
            </div>
          </section>

          <form action={signOut}>
            <button type="submit" className={quietLinkClass}>Sign out</button>
          </form>
        </div>
      </main>
    </AppShell>
  )
}
