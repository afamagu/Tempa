import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getIntroductionReminderQuestion, hasCompletedIntroduction } from './introduction-reminder-query'
const introduction = { id: 'intro', prompt: 'Introduce yourself', created_at: '2026-09-20T00:00:00Z' }

describe('introduction completion', () => {
  it('recognises the current introduction regardless of other answers', () => {
    expect(hasCompletedIntroduction(introduction, [{ question_id: 'intro', created_at: '2026-10-01T00:00:00Z' }])).toBe(true)
  })
  it('honours writing completed under the older required onboarding', () => {
    expect(hasCompletedIntroduction(introduction, [{ question_id: 'old-signup', created_at: '2026-09-10T00:00:00Z' }])).toBe(true)
  })
  it('does not treat a later weekly answer as the introduction', () => {
    expect(hasCompletedIntroduction(introduction, [{ question_id: 'weekly', created_at: '2026-10-01T00:00:00Z' }])).toBe(false)
    expect(hasCompletedIntroduction(introduction, [])).toBe(false)
  })
})
function clientWith(answerResult: object, questionResult = { data: introduction, error: null }) {
  const eq = vi.fn().mockResolvedValue(answerResult)
  const client = { from: vi.fn((table: string) => table === 'questions'
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => questionResult }) }) }
    : { select: () => ({ eq }) }) }
  return { client: client as unknown as SupabaseClient, eq }
}
describe('reminder eligibility lookup', () => {
  it('shows only after a successful lookup confirms missing completion', async () => {
    const { client, eq } = clientWith({ data: [], error: null })
    expect(await getIntroductionReminderQuestion(client, 'member')).toEqual(introduction)
    expect(eq).toHaveBeenCalledWith('user_id', 'member')
  })
  it('hides when the saved introduction exists', async () => {
    const { client } = clientWith({ data: [{ question_id: 'intro', created_at: '2026-10-01' }], error: null })
    expect(await getIntroductionReminderQuestion(client, 'member')).toBeNull()
  })
  it('hides on missing data, database errors or network failures', async () => {
    for (const result of [{ data: null, error: null }, { data: [], error: { code: 'error' } }]) {
      expect(await getIntroductionReminderQuestion(clientWith(result).client, 'member')).toBeNull()
    }
    const client = { from: () => { throw new Error('network') } } as unknown as SupabaseClient
    expect(await getIntroductionReminderQuestion(client, 'member')).toBeNull()
  })
})
