import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))
vi.mock('./discovery-entries', () => ({
  discoveryEntries: vi.fn(async (_client, rows) =>
    rows.map((row: { answerId: string; userId: string }) => ({
      userId: row.userId,
      response: { id: row.answerId },
    }))
  ),
}))

import { readRoomAnswers, readRoomLibrary } from './room-reading'

const row = (n: number) => ({
  answer_id: `answer${n}`,
  user_id: `00000000-0000-0000-0000-${String(n + 1).padStart(12, '0')}`,
  body: 'Answer',
  created_at: `2026-10-01T00:00:0${n}Z`,
  pseudonym: 'Mia',
  prompt: 'This question',
  country: 'Nigeria',
  gender: null,
  gender_custom: null,
  age_range: null,
  mark_id: null,
})

describe('Room reads', () => {
  it('shows six, keeps the lookahead hidden and carries shown identities forward', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: Array.from({ length: 7 }, (_, index) => row(index)),
      error: null,
    })
    const client = { rpc } as unknown as SupabaseClient

    const result = await readRoomAnswers(client, 'question', { country:'Nigeria' }, [], 6)

    expect(result.entries.map((entry) => entry.response.id)).toEqual([
      'answer0','answer1','answer2','answer3','answer4','answer5',
    ])
    expect(result.shownUserIds).toEqual(Array.from({ length: 6 }, (_, index) => row(index).user_id))
    expect(result.hasMore).toBe(true)
    expect(rpc).toHaveBeenCalledWith('room_read_question_answer_batch', {
      p_question_id:'question',
      p_exclude_user_ids:[],
      p_limit:6,
      p_country:'Nigeria',
      p_gender:null,
      p_age:null,
    })
  })

  it('passes prior identities to the next batch rather than using a moving cursor', async () => {
    const shown = [row(0).user_id, row(1).user_id]
    const rpc = vi.fn().mockResolvedValue({ data:[row(2)], error:null })

    await readRoomAnswers(
      { rpc } as unknown as SupabaseClient,
      'question',
      {},
      shown,
      6
    )

    expect(rpc).toHaveBeenCalledWith(
      'room_read_question_answer_batch',
      expect.objectContaining({ p_exclude_user_ids:shown })
    )
  })

  it('does not substitute answers from another question after an error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data:null, error:{ message:'internal' } })
    const result = await readRoomAnswers(
      { rpc } as unknown as SupabaseClient,
      'question'
    )

    expect(result.entries).toEqual([])
    expect(result.error).not.toContain('internal')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('bounds the library search and hides its extra pagination row', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data:Array.from({ length:7 }, (_, n) => ({ id:`q${n}` })),
      error:null,
    })
    const result = await readRoomLibrary(
      { rpc } as unknown as SupabaseClient,
      'x'.repeat(150)
    )

    expect(result.questions).toHaveLength(6)
    expect(result.hasMore).toBe(true)
    expect(rpc).toHaveBeenCalledWith('room_question_library', {
      p_search:'x'.repeat(100),
      p_offset:0,
      p_limit:6,
      p_from:null,
      p_to:null,
    })
  })
})
