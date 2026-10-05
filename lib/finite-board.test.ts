import { describe, expect, it } from 'vitest'
import { composeFiniteBoardItems, type BoardFeedItem } from './dispatches'
import { resolveDispatchIdentity } from './dispatch-identity'

function item(overrides: Partial<BoardFeedItem> & { id: string; authorId: string }): BoardFeedItem {
  const publishedAs = overrides.publishedAs ?? 'member'
  const authorPseudonym = overrides.authorPseudonym ?? overrides.authorId
  const authorCountry = overrides.authorCountry ?? null
  return {
    id: overrides.id,
    authorId: overrides.authorId,
    authorPseudonym,
    authorCountry,
    title: overrides.title ?? overrides.id,
    body: overrides.body ?? 'Body',
    publishedAt: overrides.publishedAt ?? '2026-10-01T00:00:00Z',
    moderationStatus: 'visible',
    topics: [],
    isKept: overrides.isKept ?? false,
    isFamiliar: overrides.isFamiliar ?? false,
    cursor: overrides.cursor ?? { seenBucket: 0, rankKey: '1', seedHash: 1, id: overrides.id },
    publishedAs,
    identity: overrides.identity ?? resolveDispatchIdentity({
      publishedAs,
      authorId: overrides.authorId,
      authorPseudonym,
      authorCountry,
      authorMarkUrl: null,
    }),
  }
}

describe('Phase 11 finite Board selection', () => {
  it('is bounded to 3 crossed-path, 2 kept and 1 unexpected Dispatch', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => item({ id:`cross-${i}`, authorId:`cross-author-${i}`, isFamiliar:true })),
      ...Array.from({ length: 4 }, (_, i) => item({ id:`kept-${i}`, authorId:`kept-author-${i}`, isKept:true, isFamiliar:true })),
      ...Array.from({ length: 3 }, (_, i) => item({ id:`new-${i}`, authorId:`new-author-${i}` })),
    ]
    const crossed = new Set(Array.from({ length: 5 }, (_, i) => `cross-author-${i}`))
    const result = composeFiniteBoardItems(items, crossed, 'viewer')

    expect(result.crossedPaths).toHaveLength(3)
    expect(result.kept).toHaveLength(2)
    expect(result.unexpected).toHaveLength(1)
    expect([...result.crossedPaths, ...result.kept, ...result.unexpected]).toHaveLength(6)
  })

  it('never duplicates a Dispatch across sections', () => {
    const shared = item({ id:'shared', authorId:'person', isKept:true, isFamiliar:true })
    const result = composeFiniteBoardItems(
      [shared, item({ id:'second', authorId:'person', isKept:true, isFamiliar:true }), item({ id:'new', authorId:'new' })],
      new Set(['person']),
      'viewer'
    )
    const ids = [...result.crossedPaths, ...result.kept, ...result.unexpected].map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('allows the same person to appear in Keep and crossed paths through different writing', () => {
    const result = composeFiniteBoardItems(
      [
        item({ id:'kept-piece', authorId:'person', isKept:true, isFamiliar:true }),
        item({ id:'cross-piece', authorId:'person', isKept:true, isFamiliar:true }),
      ],
      new Set(['person']),
      'viewer'
    )
    expect(result.kept.map((entry) => entry.id)).toContain('kept-piece')
    expect(result.crossedPaths.map((entry) => entry.id)).toContain('cross-piece')
  })

  it('keeps Something unexpected outside familiar/crossed authors', () => {
    const result = composeFiniteBoardItems(
      [
        item({ id:'familiar', authorId:'familiar-author', isFamiliar:true }),
        item({ id:'cross', authorId:'cross-author' }),
        item({ id:'unexpected', authorId:'stranger' }),
      ],
      new Set(['cross-author']),
      'viewer'
    )
    expect(result.unexpected.map((entry) => entry.id)).toEqual(['unexpected'])
  })

  it('does not classify official writing by the staff account that created it', () => {
    const official = item({
      id:'official',
      authorId:'staff-account',
      publishedAs:'tempa',
      identity: {
        kind:'tempa',
        displayName:'Tempa',
        country:null,
        markUrl:null,
      },
    } as Partial<BoardFeedItem> & { id:string; authorId:string })
    const result = composeFiniteBoardItems(
      [official],
      new Set(['staff-account']),
      'viewer'
    )
    expect(result.unexpected.map((entry) => entry.id)).toEqual(['official'])
  })

  it('never passively recommends the viewer own member Dispatch', () => {
    const result = composeFiniteBoardItems(
      [
        item({ id:'mine', authorId:'viewer' }),
        item({ id:'other', authorId:'other' }),
      ],
      new Set(),
      'viewer'
    )
    expect([...result.crossedPaths, ...result.kept, ...result.unexpected].map((entry) => entry.id)).not.toContain('mine')
  })

  it('preserves the existing candidate order within each section', () => {
    const result = composeFiniteBoardItems(
      [
        item({ id:'c1', authorId:'c1', isFamiliar:true }),
        item({ id:'c2', authorId:'c2', isFamiliar:true }),
        item({ id:'c3', authorId:'c3', isFamiliar:true }),
      ],
      new Set(['c1','c2','c3']),
      'viewer'
    )
    expect(result.crossedPaths.map((entry) => entry.id)).toEqual(['c1','c2','c3'])
  })
})
