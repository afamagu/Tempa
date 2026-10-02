import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('server-only', () => ({}))
vi.mock('./discovery-entries', () => ({ discoveryEntries: vi.fn(async (_client, rows) => rows.map((r: { answerId: string }) => ({ response: { id: r.answerId } }))) }))
import { readRoomAnswers, readRoomLibrary } from './room-reading'
const row = (n: number) => ({ answer_id: `answer${n}`, user_id: `member${n}`, body: 'Answer', created_at: `2026-10-01T00:00:0${n}Z`, pseudonym: 'Mia', prompt: 'This question', country: 'Nigeria' })
describe('Room reads', () => {
  it('keeps the lookahead out of the cards and advances from the last displayed answer', async () => {
    const rpc=vi.fn().mockResolvedValue({ data: [0,1,2,3].map(row), error: null })
    const client={rpc} as unknown as SupabaseClient
    const result=await readRoomAnswers(client,'question',{country:'Nigeria'})
    expect(result.entries.map(e=>e.response.id)).toEqual(['answer0','answer1','answer2'])
    expect(result.cursor).toEqual({createdAt:row(2).created_at,answerId:'answer2'})
    expect(result.hasMore).toBe(true)
    await readRoomAnswers(client,'question',{},result.cursor)
    expect(rpc).toHaveBeenLastCalledWith('room_read_question_answers',expect.objectContaining({p_question_id:'question',p_after_id:'answer2',p_after_created_at:row(2).created_at}))
  })
  it('does not substitute answers from another question after an error', async () => {
    const rpc=vi.fn().mockResolvedValue({data:null,error:{message:'internal'}})
    const result=await readRoomAnswers({rpc} as unknown as SupabaseClient,'question')
    expect(result.entries).toEqual([]);expect(result.error).not.toContain('internal')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('bounds the library search and hides its extra pagination row', async () => {
    const rpc=vi.fn().mockResolvedValue({data:Array.from({length:7},(_,n)=>({id:`q${n}`})),error:null})
    const result=await readRoomLibrary({rpc} as unknown as SupabaseClient,'x'.repeat(150))
    expect(result.questions).toHaveLength(6);expect(result.hasMore).toBe(true)
    expect(rpc).toHaveBeenCalledWith('room_question_library',{p_search:'x'.repeat(100),p_offset:0,p_limit:6,p_from:null,p_to:null})
  })
})
