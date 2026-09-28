import type { SupabaseClient } from '@supabase/supabase-js'
import { getActivePostcards, type PostcardCatalogEntry } from './postcards'

/**
 * Commerce Checkpoint 3 — the member marketplace read model.
 *
 * Built from data a member may already read: the active Postcard
 * catalogue (postcard_catalog/postcard_versions), PUBLISHED commerce
 * products and prices (RLS hides drafts, inactive and scheduled rows),
 * published taxonomy terms and collections, the member's OWN active
 * entitlements (commerce_my_entitlements) and member-facing switch state
 * (commerce_member_context). Every select names explicit columns — never
 * internal ones (rights review, admin metadata, authors, idempotency keys).
 *
 * The displayed price is never transaction authority: an unlock calls
 * commerce_purchase_product, which re-resolves the price server-side, and
 * sending is enforced by the Checkpoint-2 ownership trigger regardless of
 * what the client believes.
 */

export type PreviewPolicy = 'still_only' | 'controlled_full' | 'controlled_teaser' | 'none'
export type CatalogueFacet = 'place' | 'mood' | 'occasion' | 'world' | 'story' | 'tag'
export type CatalogueTerm = { facet: CatalogueFacet; slug: string; label: string; aliases: string[]; order: number }

export type CatalogueItem = {
  /** Commerce product id; null only in degraded mode (commerce data unreadable). */
  productId: string | null
  kind: 'postcard' | 'gift'
  /** Stable key: the Postcard key, or the product slug for Gifts. */
  key: string
  postcardKey: string | null
  title: string
  collection: string
  location: string
  description: string | null
  thumbnailSrc: string
  /** The canonical Postcard entry (artwork, motion) — null for Gifts. */
  entry: PostcardCatalogEntry | null
  isComplimentary: boolean
  /** Current published Credit price (display only), null when none. */
  credits: number | null
  previewPolicy: PreviewPolicy
  terms: CatalogueTerm[]
  /** Editorial position from featured collections; null when unranked. */
  editorialRank: number | null
  /** False only in degraded mode: commerce state unknown, server decides. */
  commerceKnown: boolean
}

export type ItemState = 'complimentary' | 'owned' | 'available' | 'unavailable' | 'unknown'

export type MemberContext = {
  spendEnabled: boolean
  giftsEnabled: boolean
  checkoutEnabled: boolean
  /** Commerce Checkpoint 5: every checkout gate passes for this member (incl. a test-mode tester). */
  checkoutAvailable?: boolean
  balance: number
}

export type Marketplace = {
  items: CatalogueItem[]
  ownedProductIds: string[]
  ownedPostcardKeys: string[]
  context: MemberContext
  /** True when commerce data could not be read; the catalogue falls back to
   * the active Postcards with no commerce labels (the server still enforces). */
  degraded: boolean
}

// ---------- raw rows (explicit columns only) ----------
export type RawProduct = {
  id: string
  slug: string
  product_type: string
  title: string
  short_description: string | null
  story_description: string | null
  is_complimentary: boolean
  postcard_key: string | null
  preview_policy: string
}
export type RawPrice = { product_id: string; credit_amount: number | string; effective_from: string; effective_to: string | null }
export type RawProductTerm = {
  product_id: string
  display_order: number | null
  commerce_taxonomy_terms: { facet: string; slug: string; label: string; aliases: string[] | null; display_order: number | null; country_code: string | null } | null
}
export type RawCollectionProduct = {
  product_id: string
  display_order: number | null
  commerce_collections: { slug: string; title: string; is_featured: boolean; display_order: number | null } | null
}
export type RawGiftVersion = { product_id: string; title: string; image_path: string; thumbnail_path: string | null }
export type RawEntitlement = { product_id: string; product_type: string; title: string; postcard_key: string | null }

export type MarketplaceRaw = {
  postcards: PostcardCatalogEntry[]
  products: RawProduct[] | null
  prices: RawPrice[]
  productTerms: RawProductTerm[]
  collectionProducts: RawCollectionProduct[]
  giftVersions: RawGiftVersion[]
  entitlements: RawEntitlement[]
  context: MemberContext
}

const POLICIES: PreviewPolicy[] = ['still_only', 'controlled_full', 'controlled_teaser', 'none']
const FACETS: CatalogueFacet[] = ['place', 'mood', 'occasion', 'world', 'story', 'tag']

/** Internal placeholders (e.g. "MA", "NG") are never member-facing labels. */
export function isHumanLabel(label: string, countryCode?: string | null): boolean {
  const l = label.trim()
  if (l.length < 2) return false
  if (/^[A-Z]{2,3}$/.test(l)) return false
  if (countryCode && l.toUpperCase() === countryCode.toUpperCase()) return false
  return true
}

/** The one published price whose window contains `now`; null if none or ambiguous. */
export function currentPrice(prices: RawPrice[], productId: string, now: Date): number | null {
  const t = now.getTime()
  const live = prices.filter(
    (p) => p.product_id === productId && new Date(p.effective_from).getTime() <= t && (p.effective_to === null || new Date(p.effective_to).getTime() > t)
  )
  return live.length === 1 ? Number(live[0].credit_amount) : null
}

export function buildMarketplace(raw: MarketplaceRaw, now: Date = new Date()): Marketplace {
  const ownedProductIds = raw.entitlements.map((e) => e.product_id)
  const ownedPostcardKeys = raw.entitlements.map((e) => e.postcard_key).filter((k): k is string => Boolean(k))

  if (raw.products === null) {
    // Degraded: commerce unreadable. Offer the active catalogue exactly as before commerce.
    return {
      items: raw.postcards.map((entry) => postcardItem(entry, null, [], null, false)),
      ownedProductIds,
      ownedPostcardKeys,
      context: { ...raw.context, spendEnabled: false, giftsEnabled: false },
      degraded: true,
    }
  }

  const termsByProduct = new Map<string, CatalogueTerm[]>()
  for (const row of raw.productTerms) {
    const t = row.commerce_taxonomy_terms
    if (!t || !FACETS.includes(t.facet as CatalogueFacet) || !isHumanLabel(t.label, t.country_code)) continue
    const list = termsByProduct.get(row.product_id) ?? []
    list.push({ facet: t.facet as CatalogueFacet, slug: t.slug, label: t.label.trim(), aliases: t.aliases ?? [], order: t.display_order ?? 0 })
    termsByProduct.set(row.product_id, list)
  }

  const rankByProduct = new Map<string, number>()
  const featured = raw.collectionProducts
    .filter((r) => r.commerce_collections?.is_featured)
    .sort((a, b) =>
      (a.commerce_collections!.display_order ?? 0) - (b.commerce_collections!.display_order ?? 0) || (a.display_order ?? 0) - (b.display_order ?? 0)
    )
  featured.forEach((r, i) => {
    if (!rankByProduct.has(r.product_id)) rankByProduct.set(r.product_id, i)
  })

  const productByKey = new Map(raw.products.filter((p) => p.product_type === 'postcard' && p.postcard_key).map((p) => [p.postcard_key as string, p]))
  const entitlementByKey = new Map(raw.entitlements.filter((e) => e.postcard_key).map((e) => [e.postcard_key as string, e]))
  const items: CatalogueItem[] = []

  raw.postcards.forEach((entry) => {
    const product = productByKey.get(entry.key)
    if (product) {
      const credits = product.is_complimentary ? null : currentPrice(raw.prices, product.id, now)
      items.push(postcardItem(entry, product, termsByProduct.get(product.id) ?? [], rankByProduct.get(product.id) ?? null, true, credits))
      return
    }
    // Not publicly listed, but this member owns it (e.g. withdrawn from sale): still theirs to send.
    const owned = entitlementByKey.get(entry.key)
    if (owned) {
      items.push({
        ...postcardItem(entry, null, [], null, true),
        productId: owned.product_id,
        isComplimentary: false,
        title: owned.title || entry.title,
      })
    }
    // Otherwise a draft/unlisted product: never shown to members.
  })

  const giftVersionByProduct = new Map(raw.giftVersions.map((v) => [v.product_id, v]))
  for (const p of raw.products) {
    if (p.product_type !== 'gift') continue
    const version = giftVersionByProduct.get(p.id)
    if (!version) continue
    items.push({
      productId: p.id,
      kind: 'gift',
      key: p.slug,
      postcardKey: null,
      title: p.title,
      collection: '',
      location: '',
      description: p.short_description ?? p.story_description,
      thumbnailSrc: version.thumbnail_path ?? version.image_path,
      entry: null,
      isComplimentary: p.is_complimentary,
      credits: p.is_complimentary ? null : currentPrice(raw.prices, p.id, now),
      previewPolicy: 'still_only',
      terms: termsByProduct.get(p.id) ?? [],
      editorialRank: rankByProduct.get(p.id) ?? null,
      commerceKnown: true,
    })
  }

  return { items, ownedProductIds, ownedPostcardKeys, context: raw.context, degraded: false }
}

function postcardItem(
  entry: PostcardCatalogEntry,
  product: RawProduct | null,
  terms: CatalogueTerm[],
  editorialRank: number | null,
  commerceKnown: boolean,
  credits: number | null = null
): CatalogueItem {
  return {
    productId: product?.id ?? null,
    kind: 'postcard',
    key: entry.key,
    postcardKey: entry.key,
    title: product?.title || entry.title,
    collection: entry.collection,
    location: entry.location,
    description: product?.short_description ?? product?.story_description ?? null,
    thumbnailSrc: entry.frontImagePath,
    entry,
    isComplimentary: product?.is_complimentary ?? false,
    credits,
    previewPolicy: POLICIES.includes(product?.preview_policy as PreviewPolicy) ? (product!.preview_policy as PreviewPolicy) : 'still_only',
    terms,
    editorialRank,
    commerceKnown,
  }
}

// ---------- ownership / state ----------
export function itemState(item: CatalogueItem, owned: { productIds: Set<string>; postcardKeys: Set<string> }): ItemState {
  if (!item.commerceKnown) return 'unknown'
  if (item.isComplimentary) return 'complimentary'
  if ((item.productId && owned.productIds.has(item.productId)) || (item.postcardKey && owned.postcardKeys.has(item.postcardKey))) return 'owned'
  return item.credits !== null ? 'available' : 'unavailable'
}

/** May this member attach it to a Letter/Dispatch right now? (The server re-checks.) */
export function isSendable(state: ItemState, item: CatalogueItem): boolean {
  return item.kind === 'postcard' && (state === 'complimentary' || state === 'owned' || state === 'unknown')
}

export function stateLabel(state: ItemState, credits: number | null): string {
  switch (state) {
    case 'complimentary':
      return 'Complimentary'
    case 'owned':
      return 'Yours'
    case 'available':
      return `${credits} Credits`
    case 'unavailable':
      return 'Unavailable'
    default:
      return ''
  }
}

// ---------- discovery ----------
export type DiscoveryView = 'for_you' | 'countries' | 'moods' | 'occasions' | 'worlds' | 'stories' | 'complimentary'

export const VIEW_LABELS: Record<DiscoveryView, string> = {
  // Owner decision (Checkpoint 3): member-facing label is "Featured" until real
  // personalisation exists (Checkpoint 8). The internal view key stays 'for_you'.
  for_you: 'Featured',
  countries: 'Countries',
  moods: 'Moods',
  occasions: 'Occasions',
  worlds: 'Worlds',
  stories: 'Stories',
  complimentary: 'Complimentary',
}

export const VIEW_FACET: Partial<Record<DiscoveryView, CatalogueFacet>> = {
  countries: 'place',
  moods: 'mood',
  occasions: 'occasion',
  worlds: 'world',
  stories: 'story',
}

/** Terms of one facet that at least one listed item carries — empty facets are hidden. */
export function facetTerms(items: CatalogueItem[], facet: CatalogueFacet): { slug: string; label: string; count: number }[] {
  const bySlug = new Map<string, { slug: string; label: string; count: number; order: number }>()
  for (const item of items) {
    for (const t of item.terms) {
      if (t.facet !== facet) continue
      const cur = bySlug.get(t.slug) ?? { slug: t.slug, label: t.label, count: 0, order: t.order }
      cur.count += 1
      bySlug.set(t.slug, cur)
    }
  }
  return [...bySlug.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)).map(({ slug, label, count }) => ({ slug, label, count }))
}

/** Discovery views that have something to show. Featured is always present when anything is listed. */
export function availableViews(items: CatalogueItem[]): DiscoveryView[] {
  if (items.length === 0) return []
  const views: DiscoveryView[] = ['for_you']
  for (const view of ['countries', 'moods', 'occasions', 'worlds', 'stories'] as DiscoveryView[]) {
    if (facetTerms(items, VIEW_FACET[view]!).length > 0) views.push(view)
  }
  if (items.some((i) => i.isComplimentary && i.commerceKnown)) views.push('complimentary')
  return views
}

/** Featured (Checkpoint 3): editorial/default order only — featured collections first,
 * then everything else by title. Never derived from private Letters, Moments or traits. */
export function forYouOrder(items: CatalogueItem[]): CatalogueItem[] {
  return [...items].sort((a, b) => {
    const ra = a.editorialRank ?? Number.POSITIVE_INFINITY
    const rb = b.editorialRank ?? Number.POSITIVE_INFINITY
    return ra - rb || a.title.localeCompare(b.title)
  })
}

export function searchText(item: CatalogueItem): string {
  return [item.title, item.collection, item.location, item.description ?? '', ...item.terms.flatMap((t) => [t.label, ...t.aliases])]
    .join(' \u0000 ')
    .toLowerCase()
}

export type CatalogueQuery = { view: DiscoveryView; term: string | null; search: string }

export function applyQuery(items: CatalogueItem[], q: CatalogueQuery): CatalogueItem[] {
  let out = forYouOrder(items)
  const facet = VIEW_FACET[q.view]
  if (q.view === 'complimentary') out = out.filter((i) => i.isComplimentary && i.commerceKnown)
  if (facet) out = out.filter((i) => i.terms.some((t) => t.facet === facet && (q.term === null || t.slug === q.term)))
  const words = q.search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length > 0) out = out.filter((i) => {
    const text = searchText(i)
    return words.every((w) => text.includes(w))
  })
  return out
}

// ---------- fetch ----------
const EMPTY_CONTEXT: MemberContext = { spendEnabled: false, giftsEnabled: false, checkoutEnabled: false, balance: 0 }

export async function loadMarketplace(supabase: SupabaseClient, postcards?: PostcardCatalogEntry[]): Promise<Marketplace> {
  const [catalogue, products, prices, productTerms, collectionProducts, entitlements, context] = await Promise.all([
    postcards ? Promise.resolve(postcards) : getActivePostcards(supabase),
    supabase
      .from('commerce_products')
      .select('id, slug, product_type, title, short_description, story_description, is_complimentary, postcard_key, preview_policy')
      .in('product_type', ['postcard', 'gift']),
    supabase.from('commerce_credit_prices').select('product_id, credit_amount, effective_from, effective_to'),
    supabase
      .from('commerce_product_terms')
      .select('product_id, display_order, commerce_taxonomy_terms(facet, slug, label, aliases, display_order, country_code)'),
    supabase.from('commerce_collection_products').select('product_id, display_order, commerce_collections(slug, title, is_featured, display_order)'),
    supabase.rpc('commerce_my_entitlements'),
    supabase.rpc('commerce_member_context'),
  ])

  const productRows = products.error ? null : ((products.data ?? []) as RawProduct[])
  if (products.error) console.error('[marketplace] products read failed', { code: products.error.code })
  const giftIds = (productRows ?? []).filter((p) => p.product_type === 'gift').map((p) => p.id)
  let giftVersions: RawGiftVersion[] = []
  if (giftIds.length > 0) {
    const { data } = await supabase
      .from('commerce_product_versions')
      .select('product_id, title, image_path, thumbnail_path')
      .in('product_id', giftIds)
      .eq('is_current', true)
    giftVersions = (data ?? []) as RawGiftVersion[]
  }
  const ctx = context.error ? null : (context.data as { spend_enabled?: boolean; gifts_enabled?: boolean; checkout_enabled?: boolean; checkout_available?: boolean; balance?: number | string } | null)
  let fallbackBalance = 0
  if (!ctx) {
    const { data } = await supabase.rpc('commerce_my_credit_balance')
    fallbackBalance = Number(data ?? 0)
  }

  return buildMarketplace({
    postcards: catalogue,
    products: productRows,
    prices: prices.error ? [] : ((prices.data ?? []) as RawPrice[]),
    productTerms: productTerms.error ? [] : ((productTerms.data ?? []) as unknown as RawProductTerm[]),
    collectionProducts: collectionProducts.error ? [] : ((collectionProducts.data ?? []) as unknown as RawCollectionProduct[]),
    giftVersions,
    entitlements: entitlements.error ? [] : ((entitlements.data ?? []) as RawEntitlement[]),
    // Fail closed: without the context RPC nothing is unlockable from the UI.
    context: ctx
      ? { spendEnabled: ctx.spend_enabled === true, giftsEnabled: ctx.gifts_enabled === true, checkoutEnabled: ctx.checkout_enabled === true, checkoutAvailable: ctx.checkout_available === true, balance: Number(ctx.balance ?? 0) }
      : { ...EMPTY_CONTEXT, balance: fallbackBalance },
  })
}
