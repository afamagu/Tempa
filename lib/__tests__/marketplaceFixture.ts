// Shared marketplace fixture for tests (never imported by app code).
import type { MarketplaceRaw, RawProductTerm } from '../marketplace'
import type { PostcardCatalogEntry } from '../postcards'

const entry = (key: string, title: string, extra: Partial<PostcardCatalogEntry> = {}): PostcardCatalogEntry => ({
  key,
  title,
  countryCode: 'MA',
  location: `${title} coast`,
  collection: `${title} Collection`,
  postmarkText: title.toUpperCase(),
  footerText: 'Tempa Postcard',
  frontImagePath: `/postcards/${key}.jpg`,
  motionSrc: `/postcards/${key}.mp4`,
  durationSeconds: 8,
  revealLineAlignment: null,
  ...extra,
})

export const NOW = new Date('2026-10-01T12:00:00Z')
const term = (product_id: string, facet: string, slug: string, label: string, extra: Partial<NonNullable<RawProductTerm['commerce_taxonomy_terms']>> = {}): RawProductTerm => ({
  product_id,
  display_order: 0,
  commerce_taxonomy_terms: { facet, slug, label, aliases: [], display_order: 0, country_code: null, ...extra },
})

export function fixture(overrides: Partial<MarketplaceRaw> = {}): MarketplaceRaw {
  return {
    postcards: [
      entry('essaouira', 'Essaouira'),
      entry('bangkok', 'Bangkok', { countryCode: 'TH' }),
      entry('lanterns', 'Lanterns'),
      entry('harbour', 'Harbour'),
      entry('newDraft', 'New Draft'),
      entry('noPrice', 'No Price'),
      entry('retiredOwned', 'Retired Owned'),
    ],
    products: [
      { id: 'p-ess', slug: 'postcard-essaouira', product_type: 'postcard', title: 'Essaouira', short_description: null, story_description: null, is_complimentary: true, postcard_key: 'essaouira', preview_policy: 'controlled_full' },
      { id: 'p-bkk', slug: 'postcard-bangkok', product_type: 'postcard', title: 'Bangkok', short_description: 'After the rain.', story_description: null, is_complimentary: true, postcard_key: 'bangkok', preview_policy: 'still_only' },
      { id: 'p-lan', slug: 'postcard-lanterns', product_type: 'postcard', title: 'Lanterns', short_description: 'A festival of light.', story_description: null, is_complimentary: false, postcard_key: 'lanterns', preview_policy: 'controlled_teaser' },
      { id: 'p-har', slug: 'postcard-harbour', product_type: 'postcard', title: 'Harbour', short_description: null, story_description: null, is_complimentary: false, postcard_key: 'harbour', preview_policy: 'none' },
      { id: 'p-nop', slug: 'postcard-no-price', product_type: 'postcard', title: 'No Price', short_description: null, story_description: null, is_complimentary: false, postcard_key: 'noPrice', preview_policy: 'still_only' },
      // 'newDraft' has NO visible product: RLS hides drafts from members
    ],
    prices: [
      { product_id: 'p-lan', credit_amount: '40', effective_from: '2026-09-01T00:00:00Z', effective_to: null },
      { product_id: 'p-har', credit_amount: 60, effective_from: '2026-09-01T00:00:00Z', effective_to: null },
    ],
    productTerms: [
      term('p-ess', 'place', 'ma', 'MA', { country_code: 'MA' }), // internal code placeholder
      term('p-ess', 'place', 'morocco', 'Morocco', { country_code: 'MA', aliases: ['Maghreb'] }),
      term('p-ess', 'mood', 'calm', 'Calm'),
      term('p-lan', 'mood', 'calm', 'Calm'),
      term('p-lan', 'occasion', 'celebration', 'Celebration'),
      term('p-bkk', 'tag', 'rain', 'rain', { aliases: ['monsoon'] }),
    ],
    collectionProducts: [
      { product_id: 'p-lan', display_order: 1, commerce_collections: { slug: 'featured', title: 'Featured', is_featured: true, display_order: 0 } },
      { product_id: 'p-bkk', display_order: 2, commerce_collections: { slug: 'featured', title: 'Featured', is_featured: true, display_order: 0 } },
    ],
    giftVersions: [],
    entitlements: [
      { product_id: 'p-har', product_type: 'postcard', title: 'Harbour', postcard_key: 'harbour' },
      { product_id: 'p-ret', product_type: 'postcard', title: 'Retired Owned', postcard_key: 'retiredOwned' },
    ],
    context: { spendEnabled: false, giftsEnabled: false, checkoutEnabled: false, balance: 25 },
    ...overrides,
  }
}
