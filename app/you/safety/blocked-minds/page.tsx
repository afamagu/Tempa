import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getBlockedProfiles } from '@/lib/blocking'
import { sectionLabelClass, proseSubheadingClass, helperTextClass, metadataTextClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import CountryFlag from '@/app/country-flag'
import UnblockButton from './unblock-button'
import { publicProfileMarkUrl } from '@/lib/profile-marks'

/**
 * Settings → Safety → Blocked minds — Safety & Trust Checkpoint 1B,
 * scope-aware per Checkpoint 1C. Shows only members the CURRENT viewer
 * has blocked (getBlockedProfiles, scoped server-side to the caller's
 * own blocked_users rows) — never a "blocked by" list, never a count
 * shown anywhere else in the product. Each row shows its own scope
 * ("Letters stopped" or "Blocked everywhere"); UnblockButton renders
 * the matching reversing/escalating actions for that scope.
 */
export default async function BlockedMindsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const [waitingCount, blocked] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getBlockedProfiles(supabase),
  ])

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center p-6">
        <div className="w-full max-w-2xl space-y-6 py-10">
          <div className="space-y-1">
            <p className={sectionLabelClass}>You / Settings / Safety</p>
            <h1 className={proseSubheadingClass}>Blocked minds</h1>
          </div>

          {blocked.length === 0 ? (
            <p className={helperTextClass}>You haven&rsquo;t blocked anyone.</p>
          ) : (
            <div className="space-y-2">
              {blocked.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-foreground/10 p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <ProfileIdentityMark
                      identifier={b.id}
                      markUrl={b.markId ? publicProfileMarkUrl(supabase, `${b.markId}.png`) : null}
                      label={b.markId ? `${b.pseudonym}'s Mark` : undefined}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-[15px] font-medium text-foreground">{b.pseudonym}</p>
                        <CountryFlag country={b.country} />
                      </div>
                      <p className={metadataTextClass}>
                        {b.scope === 'letters' ? 'Letters stopped' : 'Blocked everywhere'}
                      </p>
                    </div>
                  </div>
                  <UnblockButton blockedId={b.id} scope={b.scope} />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}
