import { createClient } from '@/lib/supabase/server'
import { callAdminCommerce, type CatalogItem } from '@/lib/admin-commerce'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import CatalogList from './catalog-list'

export default async function CommerceCatalogPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams
  const supabase = await createClient()
  const { data, error } = await callAdminCommerce<CatalogItem[]>(supabase, 'admin_commerce_catalog')
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Catalog</h1>
        <p className={adminMetadataClass}>
          Postcards arrive here from Content → Postcards as drafts; nothing is sold until you publish it.
        </p>
      </div>
      {error ? <p className="text-[14px] text-red-700">{error.message}</p> : <CatalogList items={data ?? []} initialAttention={show === 'attention'} />}
    </div>
  )
}
