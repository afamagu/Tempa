import { describe, it, expect } from 'vitest'
import { mapPostcardCatalogRows, postcardEntryToBaseContent, filterPostcardCatalog, type PostcardCatalogEntry } from './postcards'

// Admin Phase 2A-2 — mapPostcardCatalogRows is the pure mapper
// getActivePostcards depends on, tested directly per this codebase's
// own convention of extracting non-trivial logic out of a live-DB-
// calling function so it doesn't need a live/faked Supabase client to
// verify (same convention as lib/letters.ts's mapLetterPostcardRows).
describe('mapPostcardCatalogRows', () => {
  function versionRow(overrides: Partial<{
    title: string
    location: string
    collection: string
    postmark_text: string
    footer_text: string
    front_image_path: string
    motion_src: string | null
    duration_seconds: number | null
    reveal_line_alignment: string | null
  }> = {}) {
    return {
      title: 'Essaouira',
      location: 'Atlantic Morocco',
      collection: 'Atlantic Morocco Collection',
      postmark_text: 'ESSAOUIRA\nATLANTIC MOROCCO',
      footer_text: 'Tempa Postcard · Atlantic Morocco Collection',
      front_image_path: '/postcards/essaouira.jpg',
      motion_src: '/postcards/essaouira-living.mp4',
      duration_seconds: 10.04,
      reveal_line_alignment: null,
      ...overrides,
    }
  }

  it('maps a catalog row with its embedded current version into a flat PostcardCatalogEntry', () => {
    const result = mapPostcardCatalogRows([{ key: 'essaouira', country_code: 'MA', postcard_versions: [versionRow()] }])
    expect(result).toEqual([
      {
        key: 'essaouira',
        title: 'Essaouira',
        countryCode: 'MA',
        location: 'Atlantic Morocco',
        collection: 'Atlantic Morocco Collection',
        postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
        footerText: 'Tempa Postcard · Atlantic Morocco Collection',
        frontImagePath: '/postcards/essaouira.jpg',
        motionSrc: '/postcards/essaouira-living.mp4',
        durationSeconds: 10.04,
        revealLineAlignment: null,
      },
    ])
  })

  it('maps both currently-approved production Postcards (Essaouira and Bangkok) in one call', () => {
    const result = mapPostcardCatalogRows([
      { key: 'essaouira', country_code: 'MA', postcard_versions: [versionRow()] },
      {
        key: 'bangkokAfterRain',
        country_code: 'TH',
        postcard_versions: [
          versionRow({
            title: 'Bangkok',
            location: 'Thailand after rain',
            collection: 'Thailand After Rain Collection',
            postmark_text: 'BANGKOK\nTHAILAND',
            footer_text: 'Tempa Postcard · Thailand After Rain Collection',
            front_image_path: '/postcards/bangkok-after-rain.jpg',
            motion_src: '/postcards/bangkok-after-rain-living.mp4',
          }),
        ],
      },
    ])
    expect(result.map((r) => r.key)).toEqual(['essaouira', 'bangkokAfterRain'])
    expect(result.map((r) => r.countryCode)).toEqual(['MA', 'TH'])
  })

  it('excludes a catalog row with no current version (deactivated/no-current-version rows never make it into the embedded array the caller\'s own is_current filter produces)', () => {
    const result = mapPostcardCatalogRows([
      { key: 'essaouira', country_code: 'MA', postcard_versions: [] },
      { key: 'essaouira', country_code: 'MA', postcard_versions: null },
    ])
    expect(result).toEqual([])
  })

  it('a version with no motion asset carries motionSrc/durationSeconds as null, never fabricated', () => {
    const result = mapPostcardCatalogRows([
      { key: 'essaouira', country_code: 'MA', postcard_versions: [versionRow({ motion_src: null, duration_seconds: null })] },
    ])
    expect(result[0].motionSrc).toBeNull()
    expect(result[0].durationSeconds).toBeNull()
  })
})

describe('postcardEntryToBaseContent', () => {
  const ESSAOUIRA: PostcardCatalogEntry = {
    key: 'essaouira',
    title: 'Essaouira',
    countryCode: 'MA',
    location: 'Atlantic Morocco',
    collection: 'Atlantic Morocco Collection',
    postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
    footerText: 'Tempa Postcard · Atlantic Morocco Collection',
    frontImagePath: '/postcards/essaouira.jpg',
    motionSrc: '/postcards/essaouira-living.mp4',
    durationSeconds: 10.04,
    revealLineAlignment: null,
  }

  it('carries every presentation field straight through, with a living block when a motion asset exists', () => {
    const base = postcardEntryToBaseContent(ESSAOUIRA)
    expect(base).toEqual({
      title: 'Essaouira',
      location: 'Atlantic Morocco',
      collection: 'Atlantic Morocco Collection',
      frontImagePath: '/postcards/essaouira.jpg',
      postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
      footerText: 'Tempa Postcard · Atlantic Morocco Collection',
      living: { motionSrc: '/postcards/essaouira-living.mp4', durationSeconds: 10.04, revealLineAlignment: undefined },
    })
  })

  it('omits the living block entirely for a static (no motion asset) Postcard', () => {
    const base = postcardEntryToBaseContent({ ...ESSAOUIRA, motionSrc: null, durationSeconds: null })
    expect(base.living).toBeUndefined()
  })
})

// Release Polish Pass — the letter composer's own Postcard picker
// search, matching Admin's own filterAdminPostcards field set.
describe('filterPostcardCatalog', () => {
  const ESSAOUIRA: PostcardCatalogEntry = {
    key: 'essaouira',
    title: 'Essaouira',
    countryCode: 'MA',
    location: 'Atlantic Morocco',
    collection: 'Atlantic Morocco Collection',
    postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
    footerText: 'Tempa Postcard · Atlantic Morocco Collection',
    frontImagePath: '/postcards/essaouira.jpg',
    motionSrc: '/postcards/essaouira-living.mp4',
    durationSeconds: 10.04,
    revealLineAlignment: null,
  }
  const BANGKOK: PostcardCatalogEntry = {
    key: 'bangkokAfterRain',
    title: 'Bangkok',
    countryCode: 'TH',
    location: 'Thailand after rain',
    collection: 'Thailand After Rain Collection',
    postmarkText: 'BANGKOK\nTHAILAND',
    footerText: 'Tempa Postcard · Thailand After Rain Collection',
    frontImagePath: '/postcards/bangkok-after-rain.jpg',
    motionSrc: '/postcards/bangkok-after-rain-living.mp4',
    durationSeconds: 10.04,
    revealLineAlignment: null,
  }
  const CATALOG = [ESSAOUIRA, BANGKOK]

  it('an empty (or whitespace-only) query returns every Postcard unfiltered', () => {
    expect(filterPostcardCatalog(CATALOG, '')).toEqual(CATALOG)
    expect(filterPostcardCatalog(CATALOG, '   ')).toEqual(CATALOG)
  })

  it('matches by country code, case-insensitively', () => {
    expect(filterPostcardCatalog(CATALOG, 'TH').map((p) => p.key)).toEqual(['bangkokAfterRain'])
  })

  it('matches by a country name contained in the location text', () => {
    expect(filterPostcardCatalog(CATALOG, 'Thailand').map((p) => p.key)).toEqual(['bangkokAfterRain'])
    expect(filterPostcardCatalog(CATALOG, 'Morocco').map((p) => p.key)).toEqual(['essaouira'])
  })

  it('matches by title', () => {
    expect(filterPostcardCatalog(CATALOG, 'Bangkok').map((p) => p.key)).toEqual(['bangkokAfterRain'])
  })

  it('matches by the exact internal key, including its mixed case', () => {
    expect(filterPostcardCatalog(CATALOG, 'bangkokAfterRain').map((p) => p.key)).toEqual(['bangkokAfterRain'])
  })

  it('a query matching nothing returns an empty list, not the unfiltered catalogue', () => {
    expect(filterPostcardCatalog(CATALOG, 'Kyoto')).toEqual([])
  })
})
