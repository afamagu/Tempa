import { describe, it, expect } from 'vitest'
import { isLegalCurrent, CURRENT_TERMS_VERSION, CURRENT_COMMUNITY_GUIDELINES_VERSION } from './legal'

describe('isLegalCurrent', () => {
  it('true only when BOTH current documents are present', () => {
    expect(
      isLegalCurrent([
        { documentType: 'terms_of_service', documentVersion: CURRENT_TERMS_VERSION },
        { documentType: 'community_guidelines', documentVersion: CURRENT_COMMUNITY_GUIDELINES_VERSION },
      ])
    ).toBe(true)
  })

  it('false when only Terms is accepted', () => {
    expect(isLegalCurrent([{ documentType: 'terms_of_service', documentVersion: CURRENT_TERMS_VERSION }])).toBe(
      false
    )
  })

  it('false when only Community Guidelines is accepted', () => {
    expect(
      isLegalCurrent([{ documentType: 'community_guidelines', documentVersion: CURRENT_COMMUNITY_GUIDELINES_VERSION }])
    ).toBe(false)
  })

  it('false when an OLD version of either document is accepted, even if the other is current', () => {
    expect(
      isLegalCurrent([
        { documentType: 'terms_of_service', documentVersion: '2025-old-version' },
        { documentType: 'community_guidelines', documentVersion: CURRENT_COMMUNITY_GUIDELINES_VERSION },
      ])
    ).toBe(false)
  })

  it('false for an empty acceptance list', () => {
    expect(isLegalCurrent([])).toBe(false)
  })

  it('ignores duplicate/extra rows — still true as long as both current documents appear somewhere', () => {
    expect(
      isLegalCurrent([
        { documentType: 'terms_of_service', documentVersion: '2025-old-version' },
        { documentType: 'terms_of_service', documentVersion: CURRENT_TERMS_VERSION },
        { documentType: 'community_guidelines', documentVersion: CURRENT_COMMUNITY_GUIDELINES_VERSION },
      ])
    ).toBe(true)
  })
})
