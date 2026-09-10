import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listQuestions, setQuestionActive, updateQuestionPrompt } from './admin-questions'
import { createFakeReports } from './__tests__/simulateReportRpcs'

const ADMIN = 'user-admin'
const MODERATOR = 'user-moderator'
const MEMBER = 'user-member'
const AUTHOR = 'user-author'

function client(fake: ReturnType<typeof createFakeReports>) {
  return fake as unknown as SupabaseClient
}

function seeded(viewerId: string, staff?: Record<string, 'moderator' | 'admin'>) {
  return createFakeReports({
    viewerId,
    profiles: [{ id: AUTHOR, pseudonym: 'Author' }],
    questions: [
      { id: 'q1', slug: 'favorite-season', prompt: 'What is your favorite season?', is_active: true },
      { id: 'q2', slug: 'comfort-food', prompt: 'What is your comfort food?', is_active: false },
    ],
    questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Autumn, easily.' }],
    staff,
  })
}

describe('admin_list_questions — admin floor, canonical-only, includes counts', () => {
  it('a moderator cannot list Questions admin — this is admin-floor per the locked permission split', async () => {
    const fake = seeded(MODERATOR, { [MODERATOR]: 'moderator' })
    const { error, data } = await listQuestions(client(fake))
    expect(error?.message).toBe('Not authorized.')
    expect(data).toEqual([])
  })

  it('a non-staff member is refused', async () => {
    const fake = seeded(MEMBER)
    const { error } = await listQuestions(client(fake))
    expect(error?.message).toBe('Not authorized.')
  })

  it('an admin sees active/inactive status and the answer count for each canonical Question', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { data, error } = await listQuestions(client(fake))
    expect(error).toBeNull()
    expect(data).toHaveLength(2)
    const q1 = data.find((q) => q.slug === 'favorite-season')
    expect(q1?.isActive).toBe(true)
    expect(q1?.answerCount).toBe(1)
    const q2 = data.find((q) => q.slug === 'comfort-food')
    expect(q2?.isActive).toBe(false)
    expect(q2?.answerCount).toBe(0)
  })
})

describe('admin_set_question_active — the real deactivation lever (Decision 3)', () => {
  it('an admin can deactivate an active Question, and reactivate it', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const off = await setQuestionActive(client(fake), 'q1', false)
    expect(off.error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q1')?.is_active).toBe(false)

    const on = await setQuestionActive(client(fake), 'q1', true)
    expect(on.error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q1')?.is_active).toBe(true)
  })

  it('a moderator cannot deactivate a Question', async () => {
    const fake = seeded(MODERATOR, { [MODERATOR]: 'moderator' })
    const { error } = await setQuestionActive(client(fake), 'q1', false)
    expect(error?.message).toBe('Not authorized.')
    expect(fake._questions.find((q) => q.id === 'q1')?.is_active).toBe(true)
  })

  it('activating and deactivating write distinct audit actions', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    await setQuestionActive(client(fake), 'q1', false)
    await setQuestionActive(client(fake), 'q1', true)
    expect(fake._auditLog.map((a) => a.action)).toEqual(['question_deactivated', 'question_activated'])
  })

  it('final mutation-boundary audit item 6: activating an already-active Question is a clear error, not a fabricated audit row', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    // q1 is already active per the fixture.
    const { error } = await setQuestionActive(client(fake), 'q1', true)
    expect(error?.message).toBe('This Question is already active.')
    expect(fake._auditLog).toHaveLength(0)
  })

  it('deactivating an already-inactive Question is a clear error, not a fabricated audit row', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    // q2 is already inactive per the fixture.
    const { error } = await setQuestionActive(client(fake), 'q2', false)
    expect(error?.message).toBe('This Question is already inactive.')
    expect(fake._auditLog).toHaveLength(0)
  })

  it('final pre-apply correction item 7: a null p_active is rejected before any lookup or state change, never relying on the column constraint', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await client(fake).rpc('admin_set_question_active', {
      p_question_id: 'q1',
      p_active: null,
    })
    expect(error?.message).toBe('An active state is required.')
    // Nothing changed: q1's is_active is untouched, and no audit row
    // was written.
    expect(fake._questions.find((q) => q.id === 'q1')?.is_active).toBe(true)
    expect(fake._auditLog).toHaveLength(0)
  })
})

describe('admin_update_question_prompt — LOCKED immutability once answered (Decision 5), plus independent review item 8', () => {
  it('an inactive Question with zero answers can have its prompt edited', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await updateQuestionPrompt(client(fake), 'q2', 'What food comforts you most?')
    expect(error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q2')?.prompt).toBe('What food comforts you most?')
  })

  it('independent review item 8: an ACTIVE Question rejects the edit even with zero answers — must be deactivated first', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    // q1 is active per the fixture; use a fresh active/unanswered
    // question to isolate this gate from the answer-count gate below.
    fake._questions.push({ id: 'q3', slug: 'unanswered-active', prompt: 'Still being offered?', is_active: true })
    const { error } = await updateQuestionPrompt(client(fake), 'q3', 'New wording')
    expect(error?.message).toBe('This Question is currently active. Deactivate it before editing the prompt.')
    expect(fake._questions.find((q) => q.id === 'q3')?.prompt).toBe('Still being offered?')
  })

  it('a Question with >= 1 answer rejects the edit server-side, even once deactivated, even for an admin', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    // q1 has an answer per the fixture; deactivate it first so the
    // is_active gate above doesn't mask the answer-count gate.
    fake._questions.find((q) => q.id === 'q1')!.is_active = false
    const { error } = await updateQuestionPrompt(client(fake), 'q1', 'A different wording entirely')
    expect(error?.message).toBe('This Question already has answers and its prompt cannot be changed.')
    expect(fake._questions.find((q) => q.id === 'q1')?.prompt).toBe('What is your favorite season?')
  })

  it('a moderator cannot edit a prompt at all, regardless of active state or answer count', async () => {
    const fake = seeded(MODERATOR, { [MODERATOR]: 'moderator' })
    const { error } = await updateQuestionPrompt(client(fake), 'q2', 'New wording')
    expect(error?.message).toBe('Not authorized.')
  })
})

describe('no Create control — Decision 2, deferred', () => {
  it('the admin-questions module exposes no create function', async () => {
    const adminQuestionsModule = await import('./admin-questions')
    expect('createQuestion' in adminQuestionsModule).toBe(false)
  })
})
