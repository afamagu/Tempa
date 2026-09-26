import { createClient } from '@/lib/supabase/server'
import { callAdminCommerce, type Term } from '@/lib/admin-commerce'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import FacetManager from './facet-manager'

export default async function CommerceFacetsPage() {
  const supabase = await createClient()
  const { data, error } = await callAdminCommerce<Term[]>(supabase, 'admin_commerce_taxonomy')
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Facets</h1>
        <p className={adminMetadataClass}>
          Places, moods, occasions, worlds, stories and tags members browse and search by. Country is one facet — not the shape of the catalogue.
        </p>
      </div>
      {error ? <p className="text-[14px] text-red-700">{error.message}</p> : <FacetManager terms={data ?? []} />}
    </div>
  )
}
