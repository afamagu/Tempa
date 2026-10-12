import type { SupabaseClient } from '@supabase/supabase-js'

export type PostcardBundleOffer = {
  productId: string
  title: string
  items: { productId: string; title: string; image: string; allocation: number }[]
}

/** Public catalogue only. RLS hides draft products, versions and artwork. */
export async function loadPostcardBundles(supabase: SupabaseClient): Promise<PostcardBundleOffer[]> {
  const [{ data: products, error: pe }, { data: versions, error: ve }, { data: postcards, error: ae }] = await Promise.all([
    supabase.from('commerce_products').select('id,title,product_type,postcard_key').in('product_type', ['bundle', 'postcard']),
    supabase.from('commerce_bundle_versions').select('id,bundle_product_id,effective_from,effective_to,commerce_bundle_version_items(item_product_id,allocation_credits,display_order)').eq('state', 'published'),
    supabase.from('postcard_versions').select('postcard_key,front_image_path').eq('is_current', true),
  ])
  if (pe || ve || ae || !products || !versions || !postcards) return []
  const now = Date.now()
  const byId = new Map(products.map((p) => [p.id, p]))
  const images = new Map(postcards.map((p) => [p.postcard_key, p.front_image_path]))
  const offers: PostcardBundleOffer[] = []
  for (const product of products.filter((p) => p.product_type === 'bundle')) {
    const current = versions.filter((v) => v.bundle_product_id === product.id && new Date(v.effective_from).getTime() <= now && (!v.effective_to || new Date(v.effective_to).getTime() > now))
    if (current.length !== 1) continue
    const rows = current[0].commerce_bundle_version_items
    if (!Array.isArray(rows) || rows.length !== 6) continue
    const items: PostcardBundleOffer['items'] = []
    for (const row of [...rows].sort((a, b) => a.display_order - b.display_order)) {
      const p = byId.get(row.item_product_id)
      const image = p?.postcard_key ? images.get(p.postcard_key) : null
      const allocation = Number(row.allocation_credits)
      if (!p || p.product_type !== 'postcard' || !image || !Number.isSafeInteger(allocation) || allocation <= 0) break
      items.push({ productId: p.id, title: p.title, image, allocation })
    }
    if (items.length === 6 && new Set(items.map((i) => i.productId)).size === 6) offers.push({ productId: product.id, title: product.title, items })
  }
  return offers.sort((a, b) => a.title.localeCompare(b.title))
}

export function collectionPrice(offer: PostcardBundleOffer, ownedIds: Set<string>) {
  return offer.items.filter((item) => !ownedIds.has(item.productId)).reduce((sum, item) => sum + item.allocation, 0)
}
