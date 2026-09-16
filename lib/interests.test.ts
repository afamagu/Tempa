import { describe, it, expect } from 'vitest'
import {
  INTEREST_TAXONOMY,
  INTEREST_ALIASES,
  MIN_RECOMMENDED_INTERESTS,
  MAX_INTERESTS,
  isValidInterestKey,
  normalizeTopicText,
  matchTopicToInterests,
  matchDispatchTopicsToInterests,
  dispatchMatchesInterests,
  isReadingInterestsCountValidForNewProfile,
} from './interests'

describe('INTEREST_TAXONOMY — uniqueness and stable keys', () => {
  it('has between 18 and 24 entries', () => {
    expect(INTEREST_TAXONOMY.length).toBeGreaterThanOrEqual(18)
    expect(INTEREST_TAXONOMY.length).toBeLessThanOrEqual(24)
  })

  it('every key is unique', () => {
    const keys = INTEREST_TAXONOMY.map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every label is unique', () => {
    const labels = INTEREST_TAXONOMY.map((i) => i.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('every key is a stable, lowercase kebab-case slug (never the display label itself, so relabeling never breaks stored selections)', () => {
    for (const { key } of INTEREST_TAXONOMY) {
      expect(key).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
    }
  })

  it('every key in INTEREST_TAXONOMY has a matching entry in INTEREST_ALIASES, and vice versa', () => {
    const taxonomyKeys = new Set(INTEREST_TAXONOMY.map((i) => i.key))
    const aliasKeys = new Set(Object.keys(INTEREST_ALIASES))
    expect(aliasKeys).toEqual(taxonomyKeys)
  })

  it('isValidInterestKey is true for every taxonomy key and false for an unknown one', () => {
    for (const { key } of INTEREST_TAXONOMY) expect(isValidInterestKey(key)).toBe(true)
    expect(isValidInterestKey('not-a-real-interest')).toBe(false)
  })
})

describe('MIN/MAX selection constants', () => {
  it('MIN_RECOMMENDED_INTERESTS is 3, MAX_INTERESTS is between 6 and 10', () => {
    expect(MIN_RECOMMENDED_INTERESTS).toBe(3)
    expect(MAX_INTERESTS).toBeGreaterThanOrEqual(6)
    expect(MAX_INTERESTS).toBeLessThanOrEqual(10)
    expect(MAX_INTERESTS).toBeGreaterThan(MIN_RECOMMENDED_INTERESTS)
  })
})

describe('isReadingInterestsCountValidForNewProfile — the exact NEW-PROFILE 3-8 gate (existing members are NEVER subject to this — see app/you/interests, which never calls it)', () => {
  it('0, 1, and 2 selections are invalid for a new profile', () => {
    expect(isReadingInterestsCountValidForNewProfile(0)).toBe(false)
    expect(isReadingInterestsCountValidForNewProfile(1)).toBe(false)
    expect(isReadingInterestsCountValidForNewProfile(2)).toBe(false)
  })

  it('3 through 8 selections are all valid for a new profile (the full allowed range, inclusive at both ends)', () => {
    for (let count = 3; count <= 8; count++) {
      expect(isReadingInterestsCountValidForNewProfile(count)).toBe(true)
    }
  })

  it('9 (one past MAX_INTERESTS) is invalid — the UI\'s own selection cap should make this unreachable, but the predicate itself still enforces it', () => {
    expect(isReadingInterestsCountValidForNewProfile(9)).toBe(false)
  })
})

describe('normalizeTopicText — topic normalization', () => {
  it('lowercases, trims, and collapses internal whitespace', () => {
    expect(normalizeTopicText('  Bible Study  ')).toBe('bible study')
    expect(normalizeTopicText('Faith    &   Prayer')).toBe('faith prayer')
  })

  it('strips punctuation to spaces rather than deleting it (so "faith-based" tokenizes to two real words, not one fused word)', () => {
    expect(normalizeTopicText('faith-based')).toBe('faith based')
  })

  it('an empty/whitespace-only topic normalizes to an empty string', () => {
    expect(normalizeTopicText('   ')).toBe('')
  })
})

describe('matchTopicToInterests — exact token/phrase alias matching', () => {
  it('a single-word topic matches by exact token equality', () => {
    expect(matchTopicToInterests('faith')).toContain('spirituality-faith')
    expect(matchTopicToInterests('books')).toContain('books-literature')
  })

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(matchTopicToInterests('  FAITH ')).toContain('spirituality-faith')
  })

  it('a curated multi-word phrase alias matches the whole normalized topic', () => {
    expect(matchTopicToInterests('book club')).toContain('books-literature')
    expect(matchTopicToInterests('road trip')).toContain('travel-places')
  })

  it('NEVER a dangerous substring match — "earth" must not match the "art" alias', () => {
    expect(matchTopicToInterests('earth')).not.toContain('art-creativity')
  })

  it('NEVER a dangerous substring match — "carthage" must not match "art", and "smart" must not match "art"', () => {
    expect(matchTopicToInterests('carthage')).not.toContain('art-creativity')
    expect(matchTopicToInterests('smart')).not.toContain('art-creativity')
  })

  it('NEVER a dangerous substring match — "heartbreak" (its own curated alias) matches love-relationships, but "heart" alone must not accidentally match "art"', () => {
    expect(matchTopicToInterests('heartbreak')).toContain('love-relationships')
    expect(matchTopicToInterests('heart')).not.toContain('art-creativity')
  })

  it('an unrelated/unmapped topic matches no Interest at all', () => {
    expect(matchTopicToInterests('xyzabc123')).toEqual([])
  })

  it('a topic can match MULTIPLE Interests', () => {
    // "identity" is curated under both psychology and culture-society.
    const matches = matchTopicToInterests('identity')
    expect(matches).toContain('psychology')
    expect(matches).toContain('culture-society')
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Love & Relationships — key/label rename and sustained-relationship coverage (product review correction)', () => {
  it('the key is love-relationships with label "Love & Relationships" — the old love-dating key/label are gone', () => {
    const entry = INTEREST_TAXONOMY.find((i) => i.key === 'love-relationships')
    expect(entry).toBeDefined()
    expect(entry!.label).toBe('Love & Relationships')
    expect(INTEREST_TAXONOMY.some((i) => i.key === 'love-dating')).toBe(false)
    expect(INTEREST_TAXONOMY.some((i) => i.label === 'Love & Dating')).toBe(false)
  })

  it('marriage matches Love & Relationships', () => {
    expect(matchTopicToInterests('marriage')).toContain('love-relationships')
  })

  it('divorce matches Love & Relationships', () => {
    expect(matchTopicToInterests('divorce')).toContain('love-relationships')
  })

  it('reconciliation matches Love & Relationships', () => {
    expect(matchTopicToInterests('reconciliation')).toContain('love-relationships')
  })

  it('the curated phrase "marital conflict" matches Love & Relationships', () => {
    expect(matchTopicToInterests('marital conflict')).toContain('love-relationships')
  })

  it('the curated phrase "relationship conflict" matches Love & Relationships', () => {
    expect(matchTopicToInterests('relationship conflict')).toContain('love-relationships')
  })

  it('generic "conflict" alone does NOT match Love & Relationships — only the precise curated phrases do, per the explicit instruction not to broadly classify unrelated conflict as romantic content', () => {
    expect(matchTopicToInterests('conflict')).not.toContain('love-relationships')
    // Confirms it matches nothing at all — "conflict" was deliberately
    // never added anywhere as a bare alias.
    expect(matchTopicToInterests('conflict')).toEqual([])
  })

  it('husband/wife/separation/intimacy/partners all match Love & Relationships', () => {
    for (const topic of ['husband', 'wife', 'separation', 'intimacy', 'partners']) {
      expect(matchTopicToInterests(topic)).toContain('love-relationships')
    }
  })
})

describe('Life & Reflections — forgiveness/boundaries/loneliness (product review correction, deliberately NOT romance-specific)', () => {
  it('forgiveness matches Life & Reflections', () => {
    expect(matchTopicToInterests('forgiveness')).toContain('life-reflections')
  })

  it('boundaries matches Life & Reflections', () => {
    expect(matchTopicToInterests('boundaries')).toContain('life-reflections')
  })

  it('loneliness matches Life & Reflections', () => {
    expect(matchTopicToInterests('loneliness')).toContain('life-reflections')
  })

  it('none of forgiveness/boundaries/loneliness also match Love & Relationships — they are general reflective themes, never automatically romantic', () => {
    for (const topic of ['forgiveness', 'boundaries', 'loneliness']) {
      expect(matchTopicToInterests(topic)).not.toContain('love-relationships')
    }
  })
})

describe('multi-interest matching stays BOOLEAN for ranking, even with the expanded Love & Relationships alias set', () => {
  it('a topic matching 3 different curated interests still yields dispatchMatchesInterests === true, never a count', () => {
    // "marriage" only maps to love-relationships today, so build a
    // synthetic multi-topic Dispatch spanning 3 distinct interests to
    // prove the RESULT TYPE is still a plain boolean regardless of how
    // many interests are touched.
    const dispatchTopics = ['marriage', 'faith', 'travel']
    const matchedInterests = matchDispatchTopicsToInterests(dispatchTopics)
    expect(matchedInterests.size).toBeGreaterThanOrEqual(3)
    const result = dispatchMatchesInterests(dispatchTopics, ['love-relationships', 'spirituality-faith', 'travel-places'])
    expect(result).toBe(true)
    expect(typeof result).toBe('boolean')
  })

  it('matching 1 interest vs matching 3 interests are indistinguishable at the dispatchMatchesInterests boundary — both simply true', () => {
    const oneMatch = dispatchMatchesInterests(['marriage'], ['love-relationships'])
    const threeMatches = dispatchMatchesInterests(['marriage', 'faith', 'travel'], ['love-relationships', 'spirituality-faith', 'travel-places'])
    expect(oneMatch).toBe(true)
    expect(threeMatches).toBe(true)
    expect(oneMatch).toBe(threeMatches)
  })
})

describe('matchDispatchTopicsToInterests — union across a Dispatch\'s topics', () => {
  it('unions matches across multiple topics into one Set', () => {
    const result = matchDispatchTopicsToInterests(['faith', 'travel'])
    expect(result.has('spirituality-faith')).toBe(true)
    expect(result.has('travel-places')).toBe(true)
  })

  it('a Dispatch with topics that map to nothing curated returns an empty Set — still a normal, eligible Dispatch, just with no topical preference', () => {
    const result = matchDispatchTopicsToInterests(['xyzabc123', 'qqqqq'])
    expect(result.size).toBe(0)
  })

  it('an empty topics array returns an empty Set', () => {
    expect(matchDispatchTopicsToInterests([]).size).toBe(0)
  })
})

describe('dispatchMatchesInterests — the single boolean the ranking tie-break needs', () => {
  it('true when a Dispatch topic matches one of the viewer\'s selected Interests', () => {
    expect(dispatchMatchesInterests(['faith', 'cooking'], ['spirituality-faith'])).toBe(true)
  })

  it('false when no Dispatch topic matches any selected Interest', () => {
    expect(dispatchMatchesInterests(['music'], ['spirituality-faith', 'travel-places'])).toBe(false)
  })

  it('false (never a penalty) when the viewer has zero selected Interests — the zero-interest degrade path', () => {
    expect(dispatchMatchesInterests(['faith'], [])).toBe(false)
  })

  it('false when the Dispatch has zero topics at all', () => {
    expect(dispatchMatchesInterests([], ['spirituality-faith'])).toBe(false)
  })
})
