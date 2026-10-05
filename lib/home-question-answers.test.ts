import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getHomeQuestionAnswers, selectThreePerspectives } from './home-question-answers'
import type { DiscoveryCandidate } from './discovery'

const candidate = (
  id: string,
  country: string,
  gender: string | null,
  ageRange: string
): DiscoveryCandidate => ({
  answerId: `a-${id}`,
  userId: `u-${id}`,
  pseudonym: id,
  country,
  gender,
  genderCustom: null,
  ageRange,
  markId: null,
  body: `Answer ${id}`,
  prompt: 'This week',
})

describe('Three Perspectives', () => {
  it('prefers varied perspectives inside the fairness-ranked six-person window', () => {
    const result = selectThreePerspectives([
      candidate('1', 'Nigeria', 'Man', '35-44'),
      candidate('2', 'Nigeria', 'Man', '35-44'),
      candidate('3', 'South Africa', 'Woman', '25-34'),
      candidate('4', 'Kenya', 'Woman', '45-54'),
      candidate('5', 'Nigeria', 'Woman', '25-34'),
      candidate('6', 'Ghana', 'Man', '35-44'),
    ])

    expect(result.map((entry) => entry.userId)).toEqual(['u-1', 'u-3', 'u-4'])
  })

  it('preserves fairness order when candidates are equally novel', () => {
    const result = selectThreePerspectives([
      candidate('1', 'Nigeria', 'Man', '35-44'),
      candidate('2', 'Nigeria', 'Man', '35-44'),
      candidate('3', 'Nigeria', 'Man', '35-44'),
      candidate('4', 'Nigeria', 'Man', '35-44'),
    ])

    expect(result.map((entry) => entry.userId)).toEqual(['u-1', 'u-2', 'u-3'])
  })

  it('reads only the current Question batch and returns at most three', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { answer_id:'a1', user_id:'u1', body:'A1', pseudonym:'One', country:'Nigeria', gender:'Man', gender_custom:null, age_range:'35-44', mark_id:null, prompt:'This week' },
        { answer_id:'a2', user_id:'u2', body:'A2', pseudonym:'Two', country:'South Africa', gender:'Woman', gender_custom:null, age_range:'25-34', mark_id:null, prompt:'This week' },
        { answer_id:'a3', user_id:'u3', body:'A3', pseudonym:'Three', country:'Kenya', gender:'Woman', gender_custom:null, age_range:'45-54', mark_id:null, prompt:'This week' },
        { answer_id:'a4', user_id:'u4', body:'A4', pseudonym:'Four', country:'Ghana', gender:'Man', gender_custom:null, age_range:'35-44', mark_id:null, prompt:'This week' },
      ],
      error: null,
    })

    const result = await getHomeQuestionAnswers(
      { rpc } as unknown as SupabaseClient,
      'viewer',
      { id:'question', prompt:'This week' }
    )

    expect(result).toHaveLength(3)
    expect(rpc).toHaveBeenCalledWith('room_read_question_answer_batch', {
      p_question_id:'question',
      p_exclude_user_ids:[],
      p_limit:6,
      p_country:null,
      p_gender:null,
      p_age:null,
    })
  })

  it('fails closed when the fairness batch cannot be read', async () => {
    const rpc = vi.fn().mockResolvedValue({ data:null, error:{ message:'internal' } })
    expect(
      await getHomeQuestionAnswers(
        { rpc } as unknown as SupabaseClient,
        'viewer',
        { id:'question', prompt:'This week' }
      )
    ).toEqual([])
  })
})
