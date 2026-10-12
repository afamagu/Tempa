import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { collectionPrice, loadPostcardBundles, type PostcardBundleOffer } from './postcard-bundles'
import batch from '../docs/product/premium-postcards-batch-1.json'

const offer: PostcardBundleOffer = { productId: 'bundle', title: 'Collection', items: [84,84,83,83,83,83].map((allocation,i) => ({ productId: `p${i}`,title: `Card ${i}`,image: `/image-${i}.jpg`,allocation })) }
function client({ missing = false, ambiguous = false, error = false } = {}) {
  const data: Record<string, unknown[]> = {
    commerce_products: [{ id: 'bundle', title: 'Collection', product_type: 'bundle', postcard_key: null }, ...offer.items.slice(missing ? 1 : 0).map((i) => ({ id: i.productId, title: i.title, product_type: 'postcard', postcard_key: i.productId }))],
    commerce_bundle_versions: Array.from({length: ambiguous ? 2 : 1}, () => ({ id: 'version',bundle_product_id: 'bundle',effective_from: '2026-01-01',effective_to: null,commerce_bundle_version_items: offer.items.map((i,n) => ({item_product_id:i.productId,allocation_credits:i.allocation,display_order:n})) })),
    postcard_versions: offer.items.map((i) => ({postcard_key:i.productId,front_image_path:i.image})),
  }
  return { from: (table: string) => ({ select: () => {
    const result = Promise.resolve({data:data[table],error:error ? {message:'denied'} : null})
    return Object.assign(result, { in: () => result, eq: () => result })
  } }) } as unknown as SupabaseClient
}

describe('Postcard collections', () => {
  it('prices six new cards at exactly 500 and deducts only the owned fixed allocations', () => {
    expect(collectionPrice(offer,new Set())).toBe(500)
    expect(collectionPrice(offer,new Set(['p0']))).toBe(416)
    expect(collectionPrice(offer,new Set(offer.items.map((i) => i.productId)))).toBe(0)
  })
  it('loads only one current six-card version with member-visible artwork', async () => {
    expect(await loadPostcardBundles(client())).toEqual([offer])
    expect(await loadPostcardBundles(client({missing:true}))).toEqual([])
    expect(await loadPostcardBundles(client({ambiguous:true}))).toEqual([])
    expect(await loadPostcardBundles(client({error:true}))).toEqual([])
  })
  it('keeps distinct source designs, six complimentary cards, the Guest Room hold and every still-motion pair', () => {
    expect(batch.postcards).toHaveLength(47)
    expect(new Set(batch.postcards.map((p) => p.key)).size).toBe(47)
    expect(batch.postcards.filter((p) => p.priceCredits===0)).toHaveLength(6)
    expect(batch.postcards.some((p) => p.slug==='guest-room-13')).toBe(false)
    for (const p of batch.postcards) {
      expect(p.imageSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(p.motionSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(p.durationSeconds).toBeGreaterThan(0)
      expect(p.durationSeconds).toBeLessThan(20)
    }
  })
  it('covers all 41 premium products with seven exact six-card collections without duplicating identities', () => {
    const premium = new Set(batch.postcards.filter((p)=>p.priceCredits===100).map((p)=>p.slug))
    expect(premium.size).toBe(41)
    expect(new Set(batch.collections.flatMap((c)=>c.slugs))).toEqual(premium)
    for (const c of batch.collections) {
      expect(c.slugs).toHaveLength(6)
      expect(new Set(c.slugs).size).toBe(6)
      expect(c.allocations.reduce((a,b)=>a+b,0)).toBe(500)
    }
  })
})
