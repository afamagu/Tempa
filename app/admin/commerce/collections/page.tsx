import { createClient } from '@/lib/supabase/server'
import { callAdminCommerce, type CatalogItem, type Collection, type Overview } from '@/lib/admin-commerce'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import CollectionsManager from './collections-manager'

export default async function CommerceCollectionsPage() {
  const supabase = await createClient()
  const [collections, catalog, overview] = await Promise.all([
    callAdminCommerce<Collection[]>(supabase, 'admin_commerce_collections'),
    callAdminCommerce<CatalogItem[]>(supabase, 'admin_commerce_catalog'),
    callAdminCommerce<Overview>(supabase, 'admin_commerce_overview'),
  ])
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Collections & merchandising</h1>
        <p className={adminMetadataClass}>
          Curated groups of products. Featured collections, in the order set here, drive the marketplace’s Featured view.
        </p>
      </div>
      {collections.error ? (
        <p className="text-[14px] text-red-700">{collections.error.message}</p>
      ) : (
        <CollectionsManager
          collections={collections.data ?? []}
          catalog={(catalog.data ?? []).filter((c) => c.product_type !== 'credit_pack')}
          homeShelfEnabled={overview.data?.switches.home_shelf_enabled ?? false}
        />
      )}
    </div>
  )
}
