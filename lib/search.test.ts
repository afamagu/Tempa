import { describe, it, expect } from 'vitest'
import { toSearchResult, toSearchResults, parseExcerptMarkers, type SearchLetterboxRow } from './search'

function personRow(overrides: Partial<SearchLetterboxRow> = {}): SearchLetterboxRow {
  return {
    kind: 'person',
    person_id: 'user-1',
    pseudonym: 'Saint Nicole',
    letter_id: null,
    correspondence_id: null,
    other_pseudonym: null,
    created_at: null,
    excerpt: null,
    rank: null,
    ...overrides,
  }
}

function letterRow(overrides: Partial<SearchLetterboxRow> = {}): SearchLetterboxRow {
  return {
    kind: 'letter',
    person_id: null,
    pseudonym: null,
    letter_id: 'letter-1',
    correspondence_id: 'corr-1',
    other_pseudonym: 'Evening Quill',
    created_at: '2026-06-01T12:00:00Z',
    excerpt: 'we ⟦⟦walked⟧⟧ the beach at sunset',
    rank: 0.5,
    ...overrides,
  }
}

describe('toSearchResult / toSearchResults', () => {
  it('pseudonym (person) result maps correctly', () => {
    const result = toSearchResult(personRow())
    expect(result).toEqual({ kind: 'person', personId: 'user-1', pseudonym: 'Saint Nicole' })
  })

  it('letter result maps correctly, including the raw (still-marked) excerpt', () => {
    const result = toSearchResult(letterRow())
    expect(result).toEqual({
      kind: 'letter',
      letterId: 'letter-1',
      correspondenceId: 'corr-1',
      otherPseudonym: 'Evening Quill',
      createdAt: '2026-06-01T12:00:00Z',
      excerpt: 'we ⟦⟦walked⟧⟧ the beach at sunset',
    })
  })

  it('a letter row with a null excerpt (no headline match) degrades to an empty string, not null', () => {
    const result = toSearchResult(letterRow({ excerpt: null }))
    expect(result?.kind).toBe('letter')
    if (result?.kind === 'letter') expect(result.excerpt).toBe('')
  })

  it('a malformed row (missing required fields for its own kind) maps to null defensively', () => {
    expect(toSearchResult(personRow({ pseudonym: null }))).toBeNull()
    expect(toSearchResult(letterRow({ other_pseudonym: null }))).toBeNull()
  })

  it('toSearchResults filters out any malformed rows and preserves order otherwise', () => {
    const rows = [personRow(), letterRow({ letter_id: 'letter-2' }), personRow({ pseudonym: null })]
    const results = toSearchResults(rows)
    expect(results).toHaveLength(2)
    expect(results[0].kind).toBe('person')
    expect(results[1].kind).toBe('letter')
  })
})

describe('parseExcerptMarkers — highlighted excerpt parsing', () => {
  it('splits plain text around one highlighted span', () => {
    const segments = parseExcerptMarkers('we ⟦⟦walked⟧⟧ the beach')
    expect(segments).toEqual([
      { text: 'we ', highlighted: false },
      { text: 'walked', highlighted: true },
      { text: ' the beach', highlighted: false },
    ])
  })

  it('handles multiple highlighted spans in one excerpt', () => {
    const segments = parseExcerptMarkers('⟦⟦Saint⟧⟧ met ⟦⟦Nicole⟧⟧ today')
    expect(segments).toEqual([
      { text: 'Saint', highlighted: true },
      { text: ' met ', highlighted: false },
      { text: 'Nicole', highlighted: true },
      { text: ' today', highlighted: false },
    ])
  })

  it('plain text with no markers at all is one unhighlighted segment', () => {
    expect(parseExcerptMarkers('nothing matched here')).toEqual([
      { text: 'nothing matched here', highlighted: false },
    ])
  })

  it('an empty excerpt produces no segments', () => {
    expect(parseExcerptMarkers('')).toEqual([])
  })

  it('never leaves a literal marker character in any segment\'s text', () => {
    const segments = parseExcerptMarkers('we ⟦⟦walked⟧⟧ the ⟦⟦beach⟧⟧')
    for (const s of segments) {
      expect(s.text).not.toContain('⟦⟦')
      expect(s.text).not.toContain('⟧⟧')
    }
  })
})
