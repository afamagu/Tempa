import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PRODUCT_TYPE_LABELS, callAdminCommerce, type CatalogItem, type ProductDetail, type Term } from '@/lib/admin-commerce'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import LifecyclePanel from './lifecycle-panel'
import DetailsForm from './details-form'
import ReviewForm from './review-form'
import ArtworkPanel from './artwork-panel'
import PricingPanel from './pricing-panel'
import FacetsPanel from './facets-panel'
import BundlePanel from './bundle-panel'

export default async function CommerceProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const [detail, taxonomy, catalog] = await Promise.all([
    callAdminCommerce<ProductDetail>(supabase, 'admin_commerce_product', { p_product_id: id }),
    callAdminCommerce<Term[]>(supabase, 'admin_commerce_taxonomy'),
    callAdminCommerce<CatalogItem[]>(supabase, 'admin_commerce_catalog'),
  ])
  if (detail.error || !detail.data) {
    return (
      <div className="space-y-3">
        <Link href="/admin/commerce/catalog" className="text-[14px] text-foreground/60 underline underline-offset-4">
          ← Catalog
        </Link>
        <p className="text-[14px] text-red-700">{detail.error?.message}</p>
      </div>
    )
  }
  const d = detail.data
  const p = d.product
  const sellsForCredits = ['postcard', 'gift', 'keepsake_template'].includes(p.product_type)

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link href="/admin/commerce/catalog" className="text-[14px] text-foreground/60 underline underline-offset-4">
          ← Catalog
        </Link>
        <h1 className={sectionTitleClass}>{p.title}</h1>
        <p className={adminMetadataClass}>
          {PRODUCT_TYPE_LABELS[p.product_type]}
          {p.postcard_key ? ` · Postcard “${p.postcard_key}”` : ''} · {d.owners} {d.owners === 1 ? 'owner' : 'owners'} · {d.purchases}{' '}
          {d.purchases === 1 ? 'purchase' : 'purchases'}
        </p>
      </div>

      <LifecyclePanel detail={d} />
      <DetailsForm product={p} />
      {p.product_type !== 'credit_pack' && <ArtworkPanel detail={d} />}
      {(sellsForCredits || p.product_type === 'credit_pack') && <PricingPanel detail={d} />}
      {p.product_type === 'bundle' && <BundlePanel detail={d} catalog={catalog.data ?? []} />}
      {p.product_type !== 'credit_pack' && <FacetsPanel productId={p.id} assigned={d.terms} taxonomy={taxonomy.data ?? []} collections={d.collections} />}
      <ReviewForm product={p} />
    </div>
  )
}
