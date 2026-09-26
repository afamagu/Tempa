import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { auditActionLabel, callAdminCommerce, formatCredits, type Overview } from '@/lib/admin-commerce'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass, adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { Card, Empty, Pill, Stat, formatDate } from './ui'

/**
 * Commerce Overview — calm operational state. Counts only real data
 * (no revenue figures while no money moves); switch state is shown
 * plainly, not as an alarm panel.
 */
export default async function CommerceOverviewPage() {
  const supabase = await createClient()
  const { data: o, error } = await callAdminCommerce<Overview>(supabase, 'admin_commerce_overview')
  if (error || !o) return <p className="text-[14px] text-red-700">{error?.message}</p>

  const flutterwave = o.providers.find((p) => p.code === 'flutterwave')
  const status: [string, boolean][] = [
    ['Commerce', o.switches.commerce_enabled],
    ['Credit spending', o.switches.credit_spend_enabled],
    ['Fiat checkout', o.switches.fiat_checkout_enabled],
    ['Gifts', o.switches.gifts_enabled],
    ['Home shelf', o.switches.home_shelf_enabled],
  ]
  const attention = [
    { n: o.published_not_ready, label: 'published but no longer ready', href: '/admin/commerce/catalog?show=attention' },
    { n: o.missing_price, label: 'paid products without a current price', href: '/admin/commerce/catalog?show=attention' },
    { n: o.missing_artwork, label: 'products without current artwork', href: '/admin/commerce/catalog?show=attention' },
    { n: o.review_pending, label: 'awaiting rights or cultural review', href: '/admin/commerce/catalog?show=attention' },
    { n: o.code_only_place_terms, label: 'place terms still named with an internal code', href: '/admin/commerce/facets' },
  ].filter((a) => a.n > 0)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Commerce</h1>
        <p className={adminMetadataClass}>Catalogue, pricing and Credits for Tempa. Member-facing commerce opens only at the launch gate.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Commercial status">
        {status.map(([label, on]) => (
          <Pill key={label} tone={on ? 'good' : 'quiet'}>
            {label} {on ? 'on' : 'off'}
          </Pill>
        ))}
        <Pill tone={flutterwave?.checkout_enabled ? 'good' : 'quiet'}>Flutterwave {flutterwave?.checkout_enabled ? (flutterwave.live_mode_enabled ? 'live' : 'test') : 'disabled'}</Pill>
        <Link href="/admin/commerce/settings" className="text-[13px] text-foreground/60 underline underline-offset-4">
          Settings
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Published" value={o.products.published ?? 0} />
        <Stat label="Drafts" value={o.products.draft ?? 0} />
        <Stat label="Off sale / retired" value={(o.products.inactive ?? 0) + (o.products.retired ?? 0)} />
        <Stat label="Complimentary · paid" value={`${o.complimentary} · ${o.paid}`} />
      </div>

      <Card title="Needs attention">
        {attention.length === 0 ? (
          <p className={adminTableSecondaryClass}>Nothing needs attention.</p>
        ) : (
          <ul className="space-y-1.5">
            {attention.map((a) => (
              <li key={a.label}>
                <Link href={a.href} className={`${adminTableTextClass} hover:underline`}>
                  <span className="font-medium">{a.n}</span> {a.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Credits held by members" value={formatCredits(o.credits_outstanding)} hint={`${o.wallets} wallets`} />
        <Stat label="Negative balances" value={formatCredits(o.credits_negative)} hint="From refunds or disputes" />
        <Stat label="Orders" value={o.orders} hint={o.orders === 0 ? 'Checkout isn’t open' : undefined} />
      </div>

      <Card title="Recent Credit grants and corrections" action={<Link href="/admin/commerce/credits" className="text-[13px] text-foreground/60 underline underline-offset-4">Credits</Link>}>
        {o.recent_credit_ops.length === 0 ? (
          <Empty>No Credit grants or corrections yet.</Empty>
        ) : (
          <ul className="divide-y divide-foreground/10">
            {o.recent_credit_ops.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className={adminTableTextClass}>
                  {auditActionLabel(r.action)} · <Link href={`/admin/commerce/credits?member=${r.member_id}`} className="hover:underline">{r.member}</Link>{' '}
                  <span className="text-foreground/70">{r.delta !== null ? `${Number(r.delta) > 0 ? '+' : ''}${r.delta}` : ''}</span>
                </span>
                <span className={adminTableSecondaryClass}>
                  {r.actor} · {formatDate(r.created_at)}
                </span>
                {r.reason && <span className={`w-full ${adminTableSecondaryClass}`}>“{r.reason}”</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
