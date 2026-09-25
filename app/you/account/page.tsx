import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { isStaff } from '@/lib/admin'
import { proseSubheadingClass, helperTextClass, secondaryButtonClass, sectionLabelClass, systemBodyClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import DeleteAccountPanel from './delete-account-panel'
import TakeABreakPanel from './take-a-break-panel'

const rowClass =
  'flex items-center justify-between gap-4 rounded-md border border-foreground/10 px-4 py-3 text-[15px] text-foreground transition-colors hover:border-foreground/25 hover:bg-foreground/[.02]'

const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Notice' },
  { href: '/community-guidelines', label: 'Community Guidelines' },
  { href: '/safety', label: 'Safety' },
]

/** You → Account & privacy: legal documents, Take a break, and account deletion. */
export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const [waitingCount, staff] = await Promise.all([getWaitingLetterCount(supabase, user.id), isStaff(supabase)])

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center p-6">
        <div className="w-full max-w-2xl space-y-8 py-10">
          <div className="space-y-2">
            <Link href="/you" className={secondaryButtonClass}>
              You
            </Link>
            <h1 className={proseSubheadingClass}>Account &amp; privacy</h1>
          </div>

          <section className="space-y-3">
            <p className={sectionLabelClass}>Legal &amp; privacy</p>
            <div className="space-y-2">
              {LEGAL_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className={rowClass}>
                  <span>{link.label}</span>
                  <span aria-hidden>→</span>
                </Link>
              ))}
            </div>
          </section>

          <section id="take-a-break" className="scroll-mt-6 space-y-3">
            <p className={sectionLabelClass}>Take a break from Tempa</p>
            <p className={systemBodyClass}>
              Step away without losing what you&rsquo;ve built here. Your profile and Dispatches disappear from public
              Tempa, nobody new can write to you, and your letters and Keepsakes wait for you. Come back whenever
              you&rsquo;re ready.
            </p>
            {staff ? (
              <p className={helperTextClass}>
                Staff accounts can&rsquo;t take a break here, so Tempa content you manage stays available.
              </p>
            ) : (
              <TakeABreakPanel />
            )}
          </section>

          <section className="space-y-3">
            <p className={sectionLabelClass}>Delete account</p>
            <p className={systemBodyClass}>
              Permanently delete your Tempa account. Your profile and Mark are removed and you stop appearing to other
              members. Letters you have already sent stay with the people who received them.
            </p>
            {staff ? (
              <p className={helperTextClass}>
                Staff accounts are closed by Tempa administrators, so Tempa content you manage is never affected. Ask
                another administrator to close this account.
              </p>
            ) : (
              <DeleteAccountPanel takeBreakHref="#take-a-break" />
            )}
          </section>
        </div>
      </main>
    </AppShell>
  )
}
