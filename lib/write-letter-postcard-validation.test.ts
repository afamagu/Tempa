import { describe, it, expect } from 'vitest'
import {
  simulatePostcardValidation,
  PostcardValidationError,
  type SimPostcardCatalogEntry,
  type SimPostcardVersion,
} from './__tests__/simulateCorrespondenceRpcs'

// Admin Phase 2A-2 — write_letter/reply_to_letter are NOT touched by
// docs/sql/2026-09-21-postcard-admin-and-keepsakes.sql (they already
// resolve whichever version is_current at Send time from data alone),
// but this checkpoint's own test list asks for explicit coverage of
// their p_postcard validation, which lives entirely in the already-
// live docs/sql/2026-09-14-letter-level-postcards.sql. This exercises
// that duplicated block via simulatePostcardValidation, byte-for-byte
// mirroring its order and messages.

const CATALOG: SimPostcardCatalogEntry[] = [
  { key: 'essaouira', isActive: true },
  { key: 'bangkokAfterRain', isActive: true },
  { key: 'retired-card', isActive: false },
]

const VERSIONS: SimPostcardVersion[] = [
  { postcardKey: 'essaouira', isCurrent: true },
  { postcardKey: 'bangkokAfterRain', isCurrent: true },
  { postcardKey: 'retired-card', isCurrent: false },
  { postcardKey: 'no-current-version', isCurrent: false },
]

describe('p_postcard validation — write_letter/reply_to_letter (docs/sql/2026-09-14-letter-level-postcards.sql)', () => {
  it('a null p_postcard is a no-op — a plain text-only letter is unaffected', () => {
    expect(simulatePostcardValidation(CATALOG, VERSIONS, null)).toBeNull()
  })

  it('rejects a missing/blank postcard key', () => {
    expect(() =>
      simulatePostcardValidation(CATALOG, VERSIONS, { postcardKey: null, revealLine: null, backMessage: 'Hi' })
    ).toThrow('A Postcard requires a postcard key.')
    expect(() =>
      simulatePostcardValidation(CATALOG, VERSIONS, { postcardKey: '   ', revealLine: null, backMessage: 'Hi' })
    ).toThrow('A Postcard requires a postcard key.')
  })

  it('rejects an unknown postcard key', () => {
    expect(() =>
      simulatePostcardValidation(CATALOG, VERSIONS, { postcardKey: 'not-a-real-key', revealLine: null, backMessage: 'Hi' })
    ).toThrow('Unknown postcard.')
  })

  it('rejects a deactivated (inactive) postcard key — deactivating stops NEW sends, exactly as Admin\'s activate/deactivate promises', () => {
    expect(() =>
      simulatePostcardValidation(CATALOG, VERSIONS, { postcardKey: 'retired-card', revealLine: null, backMessage: 'Hi' })
    ).toThrow('Unknown postcard.')
  })

  it('rejects a key with no current version at all, distinctly from an unknown/inactive key', () => {
    const catalogWithOrphan: SimPostcardCatalogEntry[] = [...CATALOG, { key: 'no-current-version', isActive: true }]
    expect(() =>
      simulatePostcardValidation(catalogWithOrphan, VERSIONS, {
        postcardKey: 'no-current-version',
        revealLine: null,
        backMessage: 'Hi',
      })
    ).toThrow('This postcard has no current version available.')
  })

  it('rejects a Reveal Line longer than 32 characters', () => {
    expect(() =>
      simulatePostcardValidation(CATALOG, VERSIONS, {
        postcardKey: 'essaouira',
        revealLine: 'x'.repeat(33),
        backMessage: 'Hi',
      })
    ).toThrow("A Postcard's Reveal Line is too long.")
  })

  it('accepts a Reveal Line at exactly the 32-character boundary', () => {
    const result = simulatePostcardValidation(CATALOG, VERSIONS, {
      postcardKey: 'essaouira',
      revealLine: 'x'.repeat(32),
      backMessage: 'Hi',
    })
    expect(result?.revealLine).toHaveLength(32)
  })

  it('rejects a null back message — "the back is written for this particular sending"', () => {
    expect(() =>
      simulatePostcardValidation(CATALOG, VERSIONS, { postcardKey: 'essaouira', revealLine: null, backMessage: null })
    ).toThrow('A Postcard needs its own written message before it can be sent.')
  })

  it('rejects a whitespace-only back message — trimmed length must be non-zero', () => {
    expect(() =>
      simulatePostcardValidation(CATALOG, VERSIONS, { postcardKey: 'essaouira', revealLine: null, backMessage: '   ' })
    ).toThrow('A Postcard needs its own written message before it can be sent.')
  })

  it('rejects a back message longer than 200 characters once trimmed', () => {
    expect(() =>
      simulatePostcardValidation(CATALOG, VERSIONS, {
        postcardKey: 'essaouira',
        revealLine: null,
        backMessage: 'x'.repeat(201),
      })
    ).toThrow("A Postcard's back message is too long.")
  })

  it('stores the back message TRIMMED, matching the live table\'s own CHECK constraint', () => {
    const result = simulatePostcardValidation(CATALOG, VERSIONS, {
      postcardKey: 'essaouira',
      revealLine: null,
      backMessage: '  Made it here at last.  ',
    })
    expect(result?.backMessage).toBe('Made it here at last.')
  })

  it('a fully valid Postcard payload resolves cleanly with no error', () => {
    const result = simulatePostcardValidation(CATALOG, VERSIONS, {
      postcardKey: 'bangkokAfterRain',
      revealLine: 'Wish you were here',
      backMessage: 'A quiet moment after the rain.',
    })
    expect(result).toEqual({
      postcardKey: 'bangkokAfterRain',
      revealLine: 'Wish you were here',
      backMessage: 'A quiet moment after the rain.',
    })
  })

  it('every rejection throws the dedicated PostcardValidationError type', () => {
    expect(() =>
      simulatePostcardValidation(CATALOG, VERSIONS, { postcardKey: null, revealLine: null, backMessage: null })
    ).toThrow(PostcardValidationError)
  })

  it('a brand new Postcard added purely through Admin (no code change) is immediately sendable — proven by the catalog/versions being the only inputs this function needs', () => {
    const adminAddedCatalog: SimPostcardCatalogEntry[] = [{ key: 'kyoto', isActive: true }]
    const adminAddedVersions: SimPostcardVersion[] = [{ postcardKey: 'kyoto', isCurrent: true }]
    const result = simulatePostcardValidation(adminAddedCatalog, adminAddedVersions, {
      postcardKey: 'kyoto',
      revealLine: null,
      backMessage: 'Sent from a brand new Admin-added Postcard.',
    })
    expect(result?.postcardKey).toBe('kyoto')
  })
})
