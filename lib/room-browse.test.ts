import { describe, expect, it } from 'vitest'
import { nextRoomLetters } from './room-browse'
const item=(n:number,author=`writer-${n}`,publishedAs:'member'|'tempa'|'sponsored'='member')=>({id:`l-${n}`,authorId:author,publishedAs})
describe('The Room finite browse queue',()=>{
  it('shows six and saves every unshown letter for the next batch',()=>{
    const pool=Array.from({length:15},(_,n)=>item(n))
    const first=nextRoomLetters(pool,'viewer',new Set(),new Set())
    expect(first.added).toHaveLength(6)
    expect(first.remaining).toHaveLength(9)
    const second=nextRoomLetters(first.remaining,'viewer',new Set(first.added.map(x=>x.id)),new Set(first.added.map(x=>x.authorId)))
    expect(second.added).toHaveLength(6)
    expect(new Set([...first.added,...second.added].map(x=>x.id)).size).toBe(12)
  })
  it('prioritises new authors without losing additional works from an existing author',()=>{
    const first=nextRoomLetters([item(0,'Ada'),item(1,'Ada'),item(2,'Ben')],'viewer',new Set(),new Set())
    expect(first.added.map(x=>x.id)).toEqual(['l-0','l-2'])
    expect(first.remaining.map(x=>x.id)).toEqual(['l-1'])
  })
  it('never shows unpublished/sponsored/self/previously read sources',()=>{
    const result=nextRoomLetters([item(0,'viewer'),item(1,'Tempa','tempa'),item(2,'Sponsor','sponsored'),item(3),item(3)],'viewer',new Set(['l-3']),new Set())
    expect(result.added).toEqual([])
  })
})
