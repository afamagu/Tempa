import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only',()=>({}))

import { DIRECTORY_PAGE_SIZE, getRoomDirectoryPage } from './room-directory'

const authorId = (num:number)=>`11111111-2222-4333-8444-${String(num).padStart(12,'0')}`
const row = (num:number, letter=true)=>({
  user_id:authorId(num),pseudonym:`Member ${num}`,country:'Japan',mark_id:null,languages:['English'],
  latest_letter_id:letter?authorId(num+100):null,
  latest_letter_title:letter?'Sunday tea':null,
  latest_letter_body:letter?'She knows which tea I buy.':null,
})
function clientFor(rows:unknown[],hasMore=false) {
  const calls:{fn:string,args:Record<string,unknown>}[]=[]
  const client={rpc: async(fn:string,args:Record<string,unknown>)=>{
    calls.push({fn,args})
    return {data:{entries:rows,has_more:hasMore},error:null}
  }} as unknown as SupabaseClient
  return {client,calls}
}

describe('Room writer directory contract',()=>{
  it('enforces has-left-letter ON by default, six at a time', async()=>{
    const {client,calls}=clientFor([row(1),row(2)],true)
    const page=await getRoomDirectoryPage(client,{},'known-seed')
    expect(calls).toHaveLength(1)
    expect(calls[0].fn).toBe('discover_room_writers')
    expect(calls[0].args.p_has_letter).toBe(true)
    expect(calls[0].args.p_limit).toBe(DIRECTORY_PAGE_SIZE)
    expect(page.entries.map(e=>e.pseudonym)).toEqual(['Member 1','Member 2'])
    expect(page.entries[0].latestLetter?.excerpt).toContain('She knows')
    expect(page.hasMore).toBe(true)
  })
  it('supports deliberate inclusion of people without public letters, without inventing a bio',async()=>{
    const {client,calls}=clientFor([row(3,false)])
    const page=await getRoomDirectoryPage(client,{country:'Japan',language:'English',letters:'all'},'seed')
    expect(calls[0].args).toMatchObject({p_country:'Japan',p_language:'English',p_has_letter:false})
    expect(page.entries[0].latestLetter).toBeNull()
  })
  it('sends the stable last-user cursor while respecting server-side filtering',async()=>{
    const {client,calls}=clientFor([])
    await getRoomDirectoryPage(client,{search:'quiet'},'seed',authorId(10))
    expect(calls[0].args).toMatchObject({p_after_user_id:authorId(10),p_search:'quiet'})
  })
  it('cannot leak more than six entries even with malformed repeated backend rows',async()=>{
    const {client}=clientFor([...Array.from({length:9},(_,i)=>row(i)),row(2)])
    const page=await getRoomDirectoryPage(client,{},'seed')
    expect(page.entries).toHaveLength(6)
    expect(new Set(page.entries.map(e=>e.userId)).size).toBe(6)
  })
  it('fails closed before RPC for malicious cursor/seed',async()=>{
    const {client,calls}=clientFor([])
    const page=await getRoomDirectoryPage(client,{},'../api',authorId(1))
    expect(page.error).toBeTruthy()
    expect(calls).toHaveLength(0)
  })
})
