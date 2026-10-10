import { describe, expect, it } from 'vitest'
import { ROOM_LETTER_BATCH_SIZE, selectRoomLetterBatch } from './room-letter-selection'

const make = (n: number, author = `author-${n}`, publishedAs: 'member' | 'tempa' | 'sponsored' = 'member') =>
  ({ id: `letter-${n}`, authorId: author, publishedAs })
const viewerId = 'viewer'

describe('Room letters: finite author-diverse discovery', () => {
  it('shows up to six member letters, one per author, without rankings', () => {
    const items = Array.from({ length: 9 }, (_, i) => make(i))
    const result = selectRoomLetterBatch(items, { viewerId, previousLetterIds: new Set(), previousAuthorIds: new Set() })
    expect(result.letters.map(x => x.id)).toEqual(['letter-0','letter-1','letter-2','letter-3','letter-4','letter-5'])
    expect(result.hasUnselectedCandidates).toBe(true)
    expect(ROOM_LETTER_BATCH_SIZE).toBe(6)
  })
  it('excludes viewer, official/sponsored, duplicates and previously shown letters', () => {
    const items = [make(1),make(1),make(2,viewerId),make(3,'staff','tempa'),make(4,'sponsor','sponsored'),make(5)]
    const result=selectRoomLetterBatch(items,{viewerId,previousLetterIds:new Set(['letter-1']),previousAuthorIds:new Set()})
    expect(result.letters.map(x=>x.id)).toEqual(['letter-5'])
  })
  it('prefers new authors then fills with other unwritten letters from prior authors', () => {
    const items=[make(1,'old'),make(2,'new'),make(3,'old'),make(4,'other')]
    const result=selectRoomLetterBatch(items,{viewerId,previousLetterIds:new Set(),previousAuthorIds:new Set(['old'])})
    expect(result.letters.map(x=>x.id)).toEqual(['letter-2','letter-4','letter-1'])
    expect(result.exhaustedNewAuthors).toBe(false)
  })
  it('does not pretend six authors exist when the pool is thin', () => {
    const items=[make(1,'Ada'),make(2,'Ada'),make(3,'Ben')]
    const result=selectRoomLetterBatch(items,{viewerId,previousLetterIds:new Set(),previousAuthorIds:new Set()})
    expect(result.letters).toHaveLength(2)
    expect(result.hasUnselectedCandidates).toBe(true)
  })
  it('does not return stale cards as fresh after reading', () => {
    const result=selectRoomLetterBatch([make(1)],{viewerId,previousLetterIds:new Set(['letter-1']),previousAuthorIds:new Set(['author-1'])})
    expect(result.letters).toHaveLength(0)
    expect(result.hasUnselectedCandidates).toBe(false)
  })
})
