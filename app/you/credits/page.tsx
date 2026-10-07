import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getCreditBalance, getCreditPackOffers } from '@/lib/commerce'
import { quietLinkClass, sectionLabelClass, sectionTitleClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import TempaNote from '@/app/tempa-note'
import CreditPackList from './credit-pack-list'

/**
 * Commerce Checkpoint 5 — You → Get Credits. Offers come from
 * commerce_credit_pack_offers, which only lists packs once every checkout
 * gate passes (account, provider, test mode, switches or tester allowlist,
 * market, currency) and prices them from the published price book. The
 * page shows those server numbers; buying re-derives everything server-side.
 * Credits are for Postcards and other things you make — never for access
 * to people.
 */
export const dynamic = 'force-dynamic'

export default async function CreditsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in?next=%2Fyou%2Fcredits')
  }

  const [waitingCount, offers, balance] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getCreditPackOffers(supabase),
    getCreditBalance(supabase),
  ])

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-xl space-y-6 py-10">
          <div className="space-y-3">
            <div className="space-y-1">
              <p className={sectionLabelClass}>Credits</p>
              <h1 className={sectionTitleClass}>Get Credits</h1>
            </div>
            <p className="text-[15px] text-foreground" data-testid="credit-balance">
              You have <span className="font-medium">{balance.data ?? 0}</span> Credits.
            </p>
            <TempaNote>Credits unlock Postcards and other things you make on Tempa. They never buy access to people.</TempaNote>
          </div>

          {offers.available ? (
            <>
              {offers.mode === 'test' && (
                <p className="rounded-md border border-foreground/15 px-3 py-2 text-[13px] text-muted" data-testid="test-mode-notice">
                  Test mode — payments use Flutterwave&apos;s test environment. No real money is charged.
                </p>
              )}
              {offers.offers.length === 0 ? (
                <p className="text-[15px] text-muted">There are no Credit packs available right now.</p>
              ) : (
                <CreditPackList offers={offers.offers} />
              )}
            </>
          ) : (
            <p className="text-[15px] text-muted" data-testid="checkout-unavailable">
              {offers.reason.message}
            </p>
          )}

          <Link href="/you" className={quietLinkClass}>
            Back to You
          </Link>
        </div>
      </main>
    </AppShell>
  )
}
