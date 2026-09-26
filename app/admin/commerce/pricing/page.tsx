import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PRODUCT_TYPE_LABELS, callAdminCommerce, formatCredits, formatMinor, priceWindowState, type CatalogItem, type ProductType } from '@/lib/admin-commerce'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass, adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { Card, Empty, Pill } from '../ui'
import NewPackButton from './new-pack-button'

type Pricing = {
  credit_prices: { id: string; product_id: string; title: string; product_type: ProductType; credit_amount: number; effective_from: string; effective_to: string | null; state: string }[]
  price_books: { id: string; product_id: string; title: string; credit_amount: number | null; market: string; currency: string; amount_minor: number; usd_reference_minor: number; effective_from: string; effective_to: string | null; state: string }[]
}

export default async function CommercePricingPage() {
  const supabase = await createClient()
  const [pricing, catalog] = await Promise.all([
    callAdminCommerce<Pricing>(supabase, 'admin_commerce_pricing'),
    callAdminCommerce<CatalogItem[]>(supabase, 'admin_commerce_catalog'),
  ])
  if (pricing.error || !pricing.data) return <p className="text-[14px] text-red-700">{pricing.error?.message}</p>
  const now = new Date()

  // Credit prices grouped per product: current, next scheduled, drafts.
  const byProduct = new Map<string, { title: string; type: ProductType; current: number | null; next: { amount: number; from: string } | null; drafts: number }>()
  for (const r of pricing.data.credit_prices) {
    const e = byProduct.get(r.product_id) ?? { title: r.title, type: r.product_type, current: null, next: null, drafts: 0 }
    const w = priceWindowState(r, now)
    if (w === 'current') e.current = r.credit_amount
    if (w === 'scheduled' && (!e.next || r.effective_from < e.next.from)) e.next = { amount: r.credit_amount, from: r.effective_from }
    if (w === 'draft') e.drafts += 1
    byProduct.set(r.product_id, e)
  }
  const paidWithoutPrice = (catalog.data ?? []).filter(
    (c) => ['postcard', 'gift', 'keepsake_template'].includes(c.product_type) && !c.is_complimentary && !byProduct.get(c.id)?.current && c.lifecycle_state !== 'retired'
  )
  const packs = (catalog.data ?? []).filter((c) => c.product_type === 'credit_pack').sort((a, b) => a.display_order - b.display_order)

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Pricing</h1>
        <p className={adminMetadataClass}>Prices change by scheduling a new one — published prices are never edited. Open a product to change its price.</p>
      </div>

      <Card title="Credit prices">
        {byProduct.size === 0 && paidWithoutPrice.length === 0 ? (
          <Empty>No paid products yet. Everything in the catalogue is Complimentary.</Empty>
        ) : (
          <ul className="divide-y divide-foreground/10">
            {[...byProduct.entries()].map(([id, e]) => (
              <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/admin/commerce/catalog/${id}`} className={`${adminTableTextClass} hover:underline`}>
                  {e.title} <span className="text-muted">· {PRODUCT_TYPE_LABELS[e.type]}</span>
                </Link>
                <span className={adminTableSecondaryClass}>
                  {e.current !== null ? formatCredits(e.current) : 'No current price'}
                  {e.next ? ` → ${formatCredits(e.next.amount)} from ${new Date(e.next.from).toLocaleDateString('en', { dateStyle: 'medium' })}` : ''}
                  {e.drafts > 0 ? ` · ${e.drafts} draft` : ''}
                </span>
              </li>
            ))}
            {paidWithoutPrice
              .filter((c) => !byProduct.has(c.id))
              .map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/admin/commerce/catalog/${c.id}`} className={`${adminTableTextClass} hover:underline`}>
                    {c.title}
                  </Link>
                  <Pill tone="warn">Needs a price</Pill>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card
        title="Credit packs"
        note="What members will pay for Credits in each market. Checkout stays closed until the payments checkpoint."
        action={<NewPackButton />}
      >
        <p className="rounded-md bg-foreground/[.04] px-3 py-2 text-[13px] text-foreground/80">
          Market <span className="font-medium">*</span> is a price fallback for markets without their own row — not permission to sell everywhere.
        </p>
        {packs.length === 0 ? (
          <Empty>No Credit packs yet. Nothing is published or seeded automatically.</Empty>
        ) : (
          <ul className="divide-y divide-foreground/10">
            {packs.map((p) => {
              const rows = pricing.data!.price_books.filter((b) => b.product_id === p.id && priceWindowState(b, now) === 'current')
              return (
                <li key={p.id} className="space-y-1 py-2">
                  <Link href={`/admin/commerce/catalog/${p.id}`} className={`${adminTableTextClass} hover:underline`}>
                    {p.title} <span className="text-muted">· {formatCredits(p.credit_amount)}</span>
                  </Link>
                  <p className={adminTableSecondaryClass}>
                    {rows.length === 0 ? 'No current local prices' : rows.map((b) => `${b.market === '*' ? 'Fallback' : b.market} ${formatMinor(b.amount_minor, b.currency)}`).join(' · ')}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
