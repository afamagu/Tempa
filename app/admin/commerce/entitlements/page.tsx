import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PRODUCT_TYPE_LABELS, callAdminCommerce, type CatalogItem, type MemberCredits, type ProductType } from '@/lib/admin-commerce'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass, adminTableSecondaryClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { Card, Empty, Stat, formatDate } from '../ui'
import MemberPicker from '../member-picker'
import GrantEntitlement from './grant-entitlement'

type Entitlements = {
  entitlements: { id: string; member_id: string; member: string; product_id: string; title: string; product_type: ProductType; source_type: string; state: string; granted_at: string }[]
  gifts: { pending: number; delivered: number; cancelled: number }
}

const SOURCE: Record<string, string> = { purchase: 'Bought', bundle: 'From a bundle', promotional_grant: 'Promotion', admin_grant: 'Admin grant' }

export default async function CommerceEntitlementsPage({ searchParams }: { searchParams: Promise<{ member?: string }> }) {
  const { member } = await searchParams
  const supabase = await createClient()
  const [list, catalog, target] = await Promise.all([
    callAdminCommerce<Entitlements>(supabase, 'admin_commerce_entitlements', { p_limit: 100 }),
    callAdminCommerce<CatalogItem[]>(supabase, 'admin_commerce_catalog'),
    member ? callAdminCommerce<MemberCredits>(supabase, 'admin_commerce_member', { p_user_id: member }) : Promise.resolve(null),
  ])
  const grantable = (catalog.data ?? []).filter((c) => (c.product_type === 'postcard' && !c.is_complimentary) || c.product_type === 'keepsake_template')

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Entitlements & Gifts</h1>
        <p className={adminMetadataClass}>
          Who owns what, and why. Staff never own anything by default — an official account that needs premium artwork gets an explicit, recorded grant.
        </p>
      </div>

      <Card title="Grant a product" note="No money moves. The grant, its purpose and reason are recorded in the audit log.">
        <MemberPicker basePath="/admin/commerce/entitlements" label="Find the member or official account" />
        {target?.error && <p className="text-[14px] text-red-700">{target.error.message}</p>}
        {target?.data && (
          <GrantEntitlement
            memberId={target.data.member.id}
            memberLabel={target.data.member.label}
            owned={target.data.entitlements.filter((e) => e.state === 'active').map((e) => e.product_id)}
            products={grantable.map((g) => ({ id: g.id, title: g.title, type: g.product_type }))}
          />
        )}
      </Card>

      {list.data && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Gifts pending" value={list.data.gifts.pending} />
          <Stat label="Gifts delivered" value={list.data.gifts.delivered} />
          <Stat label="Gifts cancelled" value={list.data.gifts.cancelled} />
        </div>
      )}

      <Card title="Recent entitlements">
        {list.error ? (
          <p className="text-[14px] text-red-700">{list.error.message}</p>
        ) : list.data!.entitlements.length === 0 ? (
          <Empty>No one owns a paid product yet.</Empty>
        ) : (
          <ul className="divide-y divide-foreground/10">
            {list.data!.entitlements.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className={adminTableTextClass}>
                  <Link href={`/admin/commerce/credits?member=${e.member_id}`} className="hover:underline">
                    {e.member}
                  </Link>{' '}
                  · {e.title} <span className="text-muted">({PRODUCT_TYPE_LABELS[e.product_type]})</span>
                </span>
                <span className={adminTableSecondaryClass}>
                  {SOURCE[e.source_type] ?? e.source_type} · {formatDate(e.granted_at)}
                  {e.state === 'revoked' ? ' · revoked' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
