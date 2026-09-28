import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { callAdminCommerce, formatCredits, formatMinor } from '@/lib/admin-commerce'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass, adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { Card, Empty, Pill, formatDate } from '../ui'

type Order = {
  id: string
  reference: string
  member_id: string
  member: string
  product: string
  credits: number
  market: string
  currency: string
  amount_minor: number
  usd_reference_minor: number
  provider: string
  state: string
  /** 2026-10-26 (Checkpoint 5): 'test' | 'live' (null only for pre-checkout rows) */
  mode?: string | null
  credited?: boolean
  created_at: string
  paid_at: string | null
  attempts: { reference: string; status: string | null; transaction_id?: string | null; verification: string; reconciliation: string; expected_amount_minor: number; expected_currency: string; created_at: string }[]
  events?: { type: string; outcome: string | null; received_at: string }[]
}

/** Read-only operational view over the provider-neutral order tables (Checkpoint 5: test-mode checkout). Refunds and disputes arrive in Checkpoint 6. No keys, card data or payloads exist here to show. */
export default async function CommerceOrdersPage() {
  const supabase = await createClient()
  const { data, error } = await callAdminCommerce<Order[]>(supabase, 'admin_commerce_orders', { p_limit: 100 })
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Orders & Payments</h1>
        <p className={adminMetadataClass}>Credit-pack orders, their payment attempts and provider events. Read-only. Credits are only added after the payment is verified with the provider; refunds and disputes follow in a later checkpoint.</p>
      </div>
      {error ? (
        <p className="text-[14px] text-red-700">{error.message}</p>
      ) : (data ?? []).length === 0 ? (
        <Empty>No orders yet.</Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-foreground/10">
            {data!.map((o) => (
              <li key={o.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={adminTableTextClass}>
                    <span className="font-mono text-[14px]">{o.reference}</span> · {o.product} ({formatCredits(o.credits)})
                  </p>
                  <span className="flex items-center gap-2">
                    {o.mode === 'test' && <Pill tone="quiet">test</Pill>}
                    <Pill tone={o.state === 'paid' ? 'good' : o.state === 'failed' || o.state === 'charged_back' ? 'bad' : 'quiet'}>{o.state.replace(/_/g, ' ')}</Pill>
                  </span>
                </div>
                <p className={adminTableSecondaryClass}>
                  <Link href={`/admin/commerce/credits?member=${o.member_id}`} className="hover:underline">
                    {o.member}
                  </Link>{' '}
                  · {formatMinor(o.amount_minor, o.currency)} ({o.market === '*' ? 'fallback price' : o.market}) · ≈ {formatMinor(o.usd_reference_minor, 'USD')} · {o.provider} · {formatDate(o.created_at)}
                </p>
                {o.attempts.map((a) => (
                  <p key={a.reference} className={adminTableSecondaryClass}>
                    Attempt {a.reference}: {a.status ?? 'no status'}
                    {a.transaction_id ? ` · transaction ${a.transaction_id}` : ''} · verification {a.verification} · reconciliation {a.reconciliation}
                  </p>
                ))}
                {(o.events ?? []).length > 0 && (
                  <p className={adminTableSecondaryClass}>
                    Events: {o.events!.map((e) => `${e.type} (${e.outcome ?? 'pending'})`).join(' · ')}
                    {o.credited ? ' · Credits added' : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
