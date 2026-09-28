import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getMyOrder, type MyOrder } from '@/lib/commerce'
import { verifyAndSettle } from '@/lib/payments/settlement'
import { quietLinkClass, secondaryButtonClass, sectionLabelClass, sectionTitleClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'

/**
 * Commerce Checkpoint 5 — where Flutterwave sends the member back
 * (?status=…&tx_ref=…&transaction_id=…). The query string is a hint, never
 * proof: the order must be the signed-in member's own, and anything that
 * changes it is re-read from Flutterwave's API first (verifyAndSettle).
 * Credits are never issued because a browser came back here; the webhook
 * settles the same payment independently and replays are harmless.
 */
export const dynamic = 'force-dynamic'

const REFERENCE = /^TEMPA-[0-9A-F]{32}$/
const TRANSACTION = /^\d{1,20}$/

export default async function CreditsReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ tx_ref?: string; transaction_id?: string }>
}) {
  const { tx_ref: reference, transaction_id: transactionId } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/sign-in?next=%2Fyou%2Fcredits')
  }

  let order: MyOrder | null = reference && REFERENCE.test(reference) ? await getMyOrder(supabase, reference) : null
  if (order && order.state !== 'paid' && reference) {
    await verifyAndSettle({
      transactionId: transactionId && TRANSACTION.test(transactionId) ? transactionId : null,
      expectedReference: reference,
      source: 'return',
      eventType: 'checkout.return',
    }).catch(() => null)
    order = await getMyOrder(supabase, reference)
  }

  const waitingCount = await getWaitingLetterCount(supabase, user.id)
  const view = describe(order)

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-xl space-y-5 py-10" data-testid="checkout-return" data-state={order?.state ?? 'unknown'}>
          <div className="space-y-1">
            <p className={sectionLabelClass}>Credits</p>
            <h1 className={sectionTitleClass}>{view.title}</h1>
          </div>
          <p className="text-[15px] text-foreground">{view.body}</p>
          {order && (
            <p className="text-[15px] text-muted" data-testid="credit-balance">
              You have <span className="font-medium text-foreground">{order.balance}</span> Credits.
            </p>
          )}
          {order?.mode === 'test' && <p className="text-[13px] text-muted">Test mode — no real money was charged.</p>}
          <div className="flex flex-wrap gap-3">
            {view.pending && reference && (
              <Link href={`/you/credits/return?tx_ref=${encodeURIComponent(reference)}`} className={secondaryButtonClass}>
                Check again
              </Link>
            )}
            <Link href="/you/postcards" className={secondaryButtonClass}>
              Browse Postcards
            </Link>
            <Link href="/you/credits" className={quietLinkClass}>
              Get Credits
            </Link>
          </div>
        </div>
      </main>
    </AppShell>
  )
}

function describe(order: MyOrder | null): { title: string; body: string; pending: boolean } {
  if (!order) {
    return { title: 'We couldn’t find this checkout', body: 'If you paid, your Credits will appear once the payment is confirmed.', pending: false }
  }
  switch (order.state) {
    case 'paid':
      return { title: 'Your Credits have arrived', body: `${order.credits} Credits were added to your balance.`, pending: false }
    case 'failed':
      return { title: 'The payment didn’t go through', body: 'No Credits were added. You can try again whenever you like.', pending: false }
    case 'cancelled':
      return { title: 'Checkout was cancelled', body: 'No Credits were added. You can try again whenever you like.', pending: false }
    default:
      return {
        title: 'We’re confirming your payment',
        body: 'This usually takes a moment. Your Credits will appear as soon as the payment is confirmed.',
        pending: true,
      }
  }
}
