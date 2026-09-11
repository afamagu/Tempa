import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listQuestions, setQuestionActive, updateQuestionPrompt, createQuestion, replaceQuestion } from './admin-questions'
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
      { id: 'q3', slug: null, prompt: 'An unlisted Question not yet offered to members', is_active: false, family: 'draft' },
    ],
    questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Autumn, easily.' }],
    staff,
  })
}

describe('admin_list_questions — admin floor, FULL library (not just canonical), includes counts', () => {
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

  it('an admin sees every Question, including one not yet offered to members (slug: null)', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { data, error } = await listQuestions(client(fake))
    expect(error).toBeNull()
    expect(data).toHaveLength(3)
    const q1 = data.find((q) => q.slug === 'favorite-season')
    expect(q1?.isActive).toBe(true)
    expect(q1?.answerCount).toBe(1)
    const q2 = data.find((q) => q.slug === 'comfort-food')
    expect(q2?.isActive).toBe(false)
    expect(q2?.answerCount).toBe(0)
    const q3 = data.find((q) => q.id === 'q3')
    expect(q3?.slug).toBeNull()
    expect(q3?.family).toBe('draft')
    expect(q3?.answerCount).toBe(0)
  })
})

describe('admin_set_question_active — the real deactivation lever (Decision 3), now applies to any Question', () => {
  it('an admin can deactivate an active Question, and reactivate it', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const off = await setQuestionActive(client(fake), 'q1', false)
    expect(off.error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q1')?.is_active).toBe(false)

    const on = await setQuestionActive(client(fake), 'q1', true)
    expect(on.error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q1')?.is_active).toBe(true)
  })

  it('activate/deactivate now also works on a non-canonical Question (slug: null)', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await setQuestionActive(client(fake), 'q3', true)
    expect(error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q3')?.is_active).toBe(true)
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
    const { error } = await setQuestionActive(client(fake), 'q1', true)
    expect(error?.message).toBe('This Question is already active.')
    expect(fake._auditLog).toHaveLength(0)
  })

  it('deactivating an already-inactive Question is a clear error, not a fabricated audit row', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
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

  it('a non-canonical Question (slug: null) can also have its prompt edited while inactive and unanswered', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await updateQuestionPrompt(client(fake), 'q3', 'A revised unlisted prompt')
    expect(error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q3')?.prompt).toBe('A revised unlisted prompt')
  })

  it('independent review item 8: an ACTIVE Question rejects the edit even with zero answers — must be deactivated first', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    fake._questions.push({ id: 'q4', slug: 'unanswered-active', prompt: 'Still being offered?', is_active: true })
    const { error } = await updateQuestionPrompt(client(fake), 'q4', 'New wording')
    expect(error?.message).toBe('This Question is currently active. Deactivate it before editing the prompt.')
    expect(fake._questions.find((q) => q.id === 'q4')?.prompt).toBe('Still being offered?')
  })

  it('a Question with >= 1 answer rejects the edit server-side, even once deactivated, even for an admin', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
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

describe('admin_create_question — builds the library; never live to members on its own', () => {
  it('an admin can create a new Question — inactive, non-canonical (slug: null)', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { data: newId, error } = await createQuestion(client(fake), 'What does home smell like?', 'place')
    expect(error).toBeNull()
    expect(newId).toBeTruthy()
    const created = fake._questions.find((q) => q.id === newId)
    expect(created?.slug).toBeNull()
    expect(created?.is_active).toBe(false)
    expect(created?.family).toBe('place')
    expect(fake._auditLog.at(-1)?.action).toBe('question_created')
  })

  it('rejects a blank prompt', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await createQuestion(client(fake), '   ')
    expect(error?.message).toBe('A prompt is required.')
  })

  it('a moderator cannot create a Question', async () => {
    const fake = seeded(MODERATOR, { [MODERATOR]: 'moderator' })
    const { error } = await createQuestion(client(fake), 'A new prompt')
    expect(error?.message).toBe('Not authorized.')
    expect(fake._questions).toHaveLength(3)
  })
})

describe('admin_replace_question — the safe workflow for an ANSWERED Question', () => {
  it('creates a new Question row and preserves the old one and its historical answer untouched', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const before = fake._questionAnswers.find((qa) => qa.id === 'a1')
    const { data: newId, error } = await replaceQuestion(client(fake), 'q1', 'What season do you long for?')
    expect(error).toBeNull()
    expect(newId).toBeTruthy()
    expect(newId).not.toBe('q1')

    // The old Question is completely untouched in wording.
    const old = fake._questions.find((q) => q.id === 'q1')
    expect(old?.prompt).toBe('What is your favorite season?')
    // Deactivated by default.
    expect(old?.is_active).toBe(false)

    // The new Question exists with the revised wording, non-canonical,
    // and — Question source-of-truth correction, Section 3 — ACTIVE by
    // default because q1 (the old Question) was active at call time.
    const replacement = fake._questions.find((q) => q.id === newId)
    expect(replacement?.prompt).toBe('What season do you long for?')
    expect(replacement?.slug).toBeNull()
    expect(replacement?.is_active).toBe(true)

    // The historical answer is never reassigned or rewritten — it still
    // points at the OLD Question's id.
    const after = fake._questionAnswers.find((qa) => qa.id === 'a1')
    expect(after).toEqual(before)
    expect(after?.question_id).toBe('q1')
  })

  it('deactivateOld: false leaves the old Question active', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    await replaceQuestion(client(fake), 'q1', 'Revised wording', { deactivateOld: false })
    expect(fake._questions.find((q) => q.id === 'q1')?.is_active).toBe(true)
  })

  it('replacing an INACTIVE Question defaults the replacement to inactive too (mirrors old state)', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    // q2 is inactive per the fixture.
    const { data: newId } = await replaceQuestion(client(fake), 'q2', 'Revised comfort-food wording')
    expect(fake._questions.find((q) => q.id === newId)?.is_active).toBe(false)
  })

  it('an explicit newActive override wins over the mirror default', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    // q1 is active, but the admin explicitly stages the replacement inactive.
    const { data: newId } = await replaceQuestion(client(fake), 'q1', 'Staged, not yet live', { newActive: false })
    expect(fake._questions.find((q) => q.id === newId)?.is_active).toBe(false)
  })

  it('rejects a blank replacement prompt, leaving the old Question and library untouched', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await replaceQuestion(client(fake), 'q1', '   ')
    expect(error?.message).toBe('A prompt is required.')
    expect(fake._questions).toHaveLength(3)
    expect(fake._questions.find((q) => q.id === 'q1')?.is_active).toBe(true)
  })

  it('a moderator cannot replace a Question', async () => {
    const fake = seeded(MODERATOR, { [MODERATOR]: 'moderator' })
    const { error } = await replaceQuestion(client(fake), 'q1', 'Revised wording')
    expect(error?.message).toBe('Not authorized.')
    expect(fake._questions).toHaveLength(3)
  })

  it('a non-existent Question is rejected', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { error } = await replaceQuestion(client(fake), 'not-a-real-id', 'Revised wording')
    expect(error?.message).toBe('Question not found.')
  })
})
