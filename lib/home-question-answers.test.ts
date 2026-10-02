import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getHomeQuestionAnswers } from './home-question-answers'

const answer = (id: string, question_id = 'current') => ({ id, question_id, user_id: `u-${id}`, body: `Answer ${id}`, created_at: id })
function client(pages: ReturnType<typeof answer>[][], readIds: string[] = [], fail = '') {
  let page = 0
  const calls: unknown[][] = []
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    let ids: string[] = []
    for (const method of ['select','eq','neq','order','in']) chain[method] = (...args: unknown[]) => { calls.push([table, method, ...args]); if (method === 'in') ids = args[1] as string[]; return chain }
    chain.range = () => Promise.resolve({ data: pages[page++] ?? [], error: table === fail ? {} : null })
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'public_profiles' ? ids.filter(id => id !== 'u-hidden').map(id => ({id,pseudonym:id,country:'NG',mark_id:null})) : readIds.map(answer_id => ({answer_id})), error: table === fail ? {} : null }).then(resolve)
    return chain
  })
  return { supabase: { from, rpc: vi.fn(async (_name, args) => ({data: args.p_author !== 'u-deactivated',error:null})) } as unknown as SupabaseClient, calls }
}
describe('Home question answers', () => {
  it('keeps the newest three visible answers even after reading', async () => {
    const c = client([[answer('old','old-question'),answer('hidden'),answer('deactivated'),answer('a'),answer('b'),answer('c'),answer('d')]],['read'])
    const result = await getHomeQuestionAnswers(c.supabase,'viewer',{id:'current',prompt:'This week'})
    expect(result.map(a => a.answerId)).toEqual(['a','b','c'])
    expect(result.every(a => a.prompt === 'This week')).toBe(true)
    expect(c.calls).toContainEqual(['question_answers','eq','question_id','current'])
    expect(c.calls.some(c => c[0] === 'member_answer_reads')).toBe(false)
    expect(c.calls).toContainEqual(['question_answers','order','created_at',{ascending:false}])
    expect(c.calls.some(c => c[1] === 'neq')).toBe(false)
    expect(c.calls.some(c => c[0] === 'correspondences')).toBe(false)
  })
  it('does not remove answers after they have been read', async () => {
    const c = client([[answer('a'),answer('b'),answer('c')]],['a','b','c'])
    expect((await getHomeQuestionAnswers(c.supabase,'viewer',{id:'current',prompt:'Q'})).map(a=>a.answerId)).toEqual(['a','b','c'])
  })
  it.each(['question_answers','public_profiles'])('fails closed if %s cannot be read',async fail=>{
    const c=client([[answer('a')]],[],fail)
    expect(await getHomeQuestionAnswers(c.supabase,'viewer',{id:'current',prompt:'Q'})).toEqual([])
  })
  it('leaves an unanswered question empty',async()=>{
    const c=client([[]]);expect(await getHomeQuestionAnswers(c.supabase,'viewer',{id:'current',prompt:'Q'})).toEqual([])
  })
})
