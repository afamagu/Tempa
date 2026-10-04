import { describe, expect, it } from 'vitest'
import {
  chooseRelationshipEpisode,
  classifyVisibleRelationshipEpisode,
} from './relationship-surface'

describe('classifyVisibleRelationshipEpisode', () => {
  it('keeps a database-established correspondence pending until the reciprocal reply is viewer-visible', () => {
    expect(
      classifyVisibleRelationshipEpisode(
        { status: 'active', established_at: '2026-10-04T10:00:00Z' },
        false
      )
    ).toBe('pending')
  })

  it('classifies an active established correspondence only when a reply is viewer-visible', () => {
    expect(
      classifyVisibleRelationshipEpisode(
        { status: 'active', established_at: '2026-10-04T10:00:00Z' },
        true
      )
    ).toBe('established')
  })

  it('keeps a canonical pending correspondence pending', () => {
    expect(
      classifyVisibleRelationshipEpisode(
        { status: 'pending', established_at: null },
        false
      )
    ).toBe('pending')
  })

  it('classifies a closed episode as past', () => {
    expect(
      classifyVisibleRelationshipEpisode(
        { status: 'closed', established_at: null },
        false
      )
    ).toBe('past')
  })
})

describe('chooseRelationshipEpisode', () => {
  it('prefers a living established relationship over old closed history', () => {
    const chosen = chooseRelationshipEpisode([
      { id: 'old', state: 'past' as const, activityAt: 200 },
      { id: 'living', state: 'established' as const, activityAt: 100 },
    ])
    expect(chosen?.id).toBe('living')
  })

  it('prefers a new pending attempt over old closed history', () => {
    const chosen = chooseRelationshipEpisode([
      { id: 'old', state: 'past' as const, activityAt: 300 },
      { id: 'new', state: 'pending' as const, activityAt: 100 },
    ])
    expect(chosen?.id).toBe('new')
  })

  it('prefers the more recent episode when lifecycle priority is equal', () => {
    const chosen = chooseRelationshipEpisode([
      { id: 'older', state: 'past' as const, activityAt: 100 },
      { id: 'newer', state: 'past' as const, activityAt: 200 },
    ])
    expect(chosen?.id).toBe('newer')
  })
})
