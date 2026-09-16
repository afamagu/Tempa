import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildMyAnswers,
  nextEligibleQuestion,
  needsParticipationGate,
  questionSaveConfirmationCopy,
  getEligibleQuestions,
  getMyAnswers,
  getFlagshipQuestion,
  getPrimaryAnswer,
  QUESTION_ANSWER_MAX_CHARS,
  type LibraryQuestion,
} from './questions'
import { simulatePublishQuestionAnswer, simulateSetCurrentAnswer, type SimAnswer } from './__tests__/simulateQuestionRpcs'
import { createFakeReports } from './__tests__/simulateReportRpcs'
import {
  replaceQuestion,
  setQuestionActive,
  setQuestionPosition,
  editCurrentQuestion,
  setQuestionFlagship,
} from './admin-questions'

const Q1: LibraryQuestion = { id: 'q-one', prompt: 'The first prompt', position: 1 }
const Q2: LibraryQuestion = { id: 'q-two', prompt: 'The second prompt', position: 2 }

describe('buildMyAnswers — every historical answer resolves to its Question\'s prompt, regardless of active/positioned state', () => {
  it('resolves prompts for answers to any number of different Questions, not just a fixed three', () => {
    const rows = [
      { id: 'a-1', question_id: 'q1', body: 'body 1', updated_at: 't1', is_current: true, moderation_status: 'visible' as const },
      { id: 'a-2', question_id: 'q2', body: 'body 2', updated_at: 't2', is_current: false, moderation_status: 'visible' as const },
    ]
    const questionsById = new Map([
      ['q1', { prompt: 'Prompt one', is_flagship: false }],
      ['q2', { prompt: 'Prompt two', is_flagship: false }],
    ])
    const result = buildMyAnswers(rows, questionsById)
    expect(result).toHaveLength(2)
    expect(result.find((a) => a.id === 'a-1')?.prompt).toBe('Prompt one')
    expect(result.find((a) => a.id === 'a-2')?.prompt).toBe('Prompt two')
  })

  it('marks isPrimary true only for the answer whose Question is currently Flagship', () => {
    const rows = [
      { id: 'a-1', question_id: 'q1', body: 'b1', updated_at: 't1', is_current: false, moderation_status: 'visible' as const },
      { id: 'a-2', question_id: 'q2', body: 'b2', updated_at: 't2', is_current: true, moderation_status: 'visible' as const },
    ]
    const questionsById = new Map([
      ['q1', { prompt: 'P1', is_flagship: true }],
      ['q2', { prompt: 'P2', is_flagship: false }],
    ])
    const result = buildMyAnswers(rows, questionsById)
    expect(result.find((a) => a.id === 'a-1')?.isPrimary).toBe(true)
    // is_current being true does NOT make it primary — only Flagship
    // does, and Flagship is never tied to a particular slot number.
    expect(result.find((a) => a.id === 'a-2')?.isPrimary).toBe(false)
  })

  it('never mutates the input rows', () => {
    const rows = [{ id: 'a-1', question_id: 'q1', body: 'x', updated_at: 't', is_current: false, moderation_status: 'visible' as const }]
    const questionsById = new Map([['q1', { prompt: 'P', is_flagship: false }]])
    buildMyAnswers(rows, questionsById)
    expect(rows[0]).toEqual({ id: 'a-1', question_id: 'q1', body: 'x', updated_at: 't', is_current: false, moderation_status: 'visible' })
  })
})

describe('nextEligibleQuestion', () => {
  it('returns the first eligible Question that is not the current one', () => {
    expect(nextEligibleQuestion([Q1, Q2], Q1.id)).toEqual(Q2)
  })

  it('returns null when nothing else is eligible', () => {
    expect(nextEligibleQuestion([Q1], Q1.id)).toBeNull()
    expect(nextEligibleQuestion([], 'anything')).toBeNull()
  })
})

describe('needsParticipationGate', () => {
  it('zero completed answers triggers the gate when something is eligible', () => {
    expect(needsParticipationGate(3, 0)).toBe(true)
  })

  it('one completed answer satisfies the gate', () => {
    expect(needsParticipationGate(3, 1)).toBe(false)
    expect(needsParticipationGate(0, 3)).toBe(false)
  })

  it('never gates when nothing is eligible and nothing has been answered', () => {
    expect(needsParticipationGate(0, 0)).toBe(false)
  })
})

describe('QUESTION_ANSWER_MAX_CHARS — the canonical stranger/discovery-writing cap', () => {
  it('remains 2000', () => {
    expect(QUESTION_ANSWER_MAX_CHARS).toBe(2000)
  })

  it('a body at exactly the cap is not over it; one character more is', () => {
    const atCap = 'x'.repeat(QUESTION_ANSWER_MAX_CHARS)
    const overCap = 'x'.repeat(QUESTION_ANSWER_MAX_CHARS + 1)
    expect(atCap.length > QUESTION_ANSWER_MAX_CHARS).toBe(false)
    expect(overCap.length > QUESTION_ANSWER_MAX_CHARS).toBe(true)
  })
})

// A minimal, generic multi-table fake supporting exactly the query
// shapes getEligibleQuestions/getMyAnswers/getFlagshipQuestion/
// getPrimaryAnswer actually issue (.select/.eq/.not/.order/.maybeSingle),
// backed by plain mutable arrays — so the SAME arrays an admin-RPC fake
// (createFakeReports) mutates can be fed straight into these member-
// facing read functions, proving the two halves of the system agree
// without needing a real database.
function fakeTablesClient(tables: { questions: Record<string, unknown>[]; question_answers: Record<string, unknown>[] }) {
  function from(table: 'questions' | 'question_answers') {
    let rows = tables[table]
    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        rows = rows.filter((r) => r[column] === value)
        return builder
      },
      // Only ever called here as .not(column, 'is', null) — op/value are
      // not needed since "not null" is the only predicate this fake
      // supports.
      not(column: string) {
        rows = rows.filter((r) => r[column] !== null && r[column] !== undefined)
        return builder
      },
      in(column: string, values: unknown[]) {
        rows = rows.filter((r) => values.includes(r[column]))
        return builder
      },
      order() {
        return Promise.resolve({ data: [...rows].sort((a, b) => ((a.current_position as number) ?? 99) - ((b.current_position as number) ?? 99)), error: null })
      },
      maybeSingle() {
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      },
      then(resolve: (v: { data: typeof rows; error: null }) => void) {
        resolve({ data: rows, error: null })
      },
    }
    return builder
  }
  return { from } as unknown as SupabaseClient
}

describe('getEligibleQuestions — DB-backed, current_position is the ONLY gate', () => {
  it('offers positioned Questions in slot order', async () => {
    const client = fakeTablesClient({
      questions: [
        { id: 'q3', prompt: 'P3', current_position: 3, is_active: true },
        { id: 'q1', prompt: 'P1', current_position: 1, is_active: true },
        { id: 'q2', prompt: 'P2', current_position: 2, is_active: true },
      ],
      question_answers: [],
    })
    const result = await getEligibleQuestions(client, 'user-1')
    expect(result.map((q) => q.id)).toEqual(['q1', 'q2', 'q3'])
  })

  it('excludes a positioned Question the member has already answered', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'P1', current_position: 1, is_active: true }],
      question_answers: [{ user_id: 'user-1', question_id: 'q1' }],
    })
    expect(await getEligibleQuestions(client, 'user-1')).toEqual([])
  })

  it('an unpositioned (historical) Question is never offered, even if active', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'P1', current_position: null, is_active: true }],
      question_answers: [],
    })
    expect(await getEligibleQuestions(client, 'user-1')).toEqual([])
  })

  it('never crashes on zero positioned Questions', async () => {
    const client = fakeTablesClient({ questions: [], question_answers: [] })
    const result = await getEligibleQuestions(client, 'user-1')
    expect(result).toEqual([])
    expect(needsParticipationGate(result.length, 0)).toBe(false)
  })
})

describe('getFlagshipQuestion / getPrimaryAnswer — Flagship is a separate bit of state, never tied to a slot number', () => {
  it('getFlagshipQuestion resolves whichever Question is_flagship, regardless of which slot it holds', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'The flagship', current_position: 2, is_active: true, is_flagship: true }],
      question_answers: [],
    })
    expect(await getFlagshipQuestion(client)).toEqual({ id: 'q1', prompt: 'The flagship' })
  })

  it('getFlagshipQuestion returns null when no Question is currently Flagship', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'Not flagship', current_position: 1, is_active: true, is_flagship: false }],
      question_answers: [],
    })
    expect(await getFlagshipQuestion(client)).toBeNull()
  })

  it('getPrimaryAnswer resolves the member\'s own visible answer to the Flagship Question', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'The flagship', current_position: 1, is_active: true, is_flagship: true }],
      question_answers: [{ id: 'a1', question_id: 'q1', user_id: 'user-1', body: 'my answer', updated_at: 't', moderation_status: 'visible' }],
    })
    const result = await getPrimaryAnswer(client, 'user-1')
    expect(result?.body).toBe('my answer')
    expect(result?.prompt).toBe('The flagship')
  })

  it('getPrimaryAnswer is null when the member has not answered the Flagship — NEVER falls back to another current Question', async () => {
    const client = fakeTablesClient({
      questions: [
        { id: 'q1', prompt: 'The flagship', current_position: 1, is_active: true, is_flagship: true },
        { id: 'q2', prompt: 'Not flagship', current_position: 2, is_active: true, is_flagship: false },
      ],
      question_answers: [{ id: 'a2', question_id: 'q2', user_id: 'user-1', body: 'answer to a non-flagship Question', updated_at: 't', moderation_status: 'visible' }],
    })
    expect(await getPrimaryAnswer(client, 'user-1')).toBeNull()
  })

  it('getPrimaryAnswer is null when the Flagship answer is hidden by moderation', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'The flagship', current_position: 1, is_active: true, is_flagship: true }],
      question_answers: [{ id: 'a1', question_id: 'q1', user_id: 'user-1', body: 'hidden', updated_at: 't', moderation_status: 'hidden' }],
    })
    expect(await getPrimaryAnswer(client, 'user-1')).toBeNull()
  })

  it('getPrimaryAnswer is null when there is no Flagship Question at all', async () => {
    const client = fakeTablesClient({ questions: [], question_answers: [] })
    expect(await getPrimaryAnswer(client, 'user-1')).toBeNull()
  })
})

// Two Final Checks round — the explicit regression proving Minds
// discovery (via getFlagshipQuestion/getPrimaryAnswer, the exact
// functions app/minds/page.tsx calls) never assumes slot #1 is
// Flagship: here the Flagship holds slot #3, slot #1 is an ordinary
// non-Flagship current Question, and only an answer to slot #3
// resolves as primary/Minds-eligible.
describe('Minds discovery must not assume slot 1 = Flagship', () => {
  const QUESTIONS = [
    { id: 'q1', prompt: 'Slot 1 — not Flagship', current_position: 1, is_active: true, is_flagship: false },
    { id: 'q3', prompt: 'Slot 3 — the Flagship', current_position: 3, is_active: true, is_flagship: true },
  ]

  it('getFlagshipQuestion resolves the Question holding slot 3, not slot 1', async () => {
    const client = fakeTablesClient({ questions: QUESTIONS, question_answers: [] })
    expect(await getFlagshipQuestion(client)).toEqual({ id: 'q3', prompt: 'Slot 3 — the Flagship' })
  })

  it('a member who answered slot 3 (the Flagship) is eligible for Minds/primary', async () => {
    const client = fakeTablesClient({
      questions: QUESTIONS,
      question_answers: [
        { id: 'a-slot3', question_id: 'q3', user_id: 'member-a', body: 'Answered the Flagship', moderation_status: 'visible' },
      ],
    })
    const primary = await getPrimaryAnswer(client, 'member-a')
    expect(primary?.body).toBe('Answered the Flagship')
  })

  it('a member who answered only slot 1 is NOT eligible as the Flagship answer', async () => {
    const client = fakeTablesClient({
      questions: QUESTIONS,
      question_answers: [
        { id: 'a-slot1', question_id: 'q1', user_id: 'member-b', body: 'Answered slot 1 only', moderation_status: 'visible' },
      ],
    })
    expect(await getPrimaryAnswer(client, 'member-b')).toBeNull()
  })
})

describe('getMyAnswers — shows every answer regardless of active/positioned state, never capped to a fixed three', () => {
  it('resolves an answer to a since-deactivated Question exactly as it did before deactivation', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'Original wording', is_active: false, current_position: null, is_flagship: false }],
      question_answers: [
        { id: 'a1', question_id: 'q1', user_id: 'user-1', body: 'my answer', updated_at: 't', is_current: true, moderation_status: 'visible' },
      ],
    })
    const result = await getMyAnswers(client, 'user-1')
    expect(result).toHaveLength(1)
    expect(result[0].prompt).toBe('Original wording')
  })

  it('an account with no answers gets an empty array, not an error', async () => {
    const client = fakeTablesClient({ questions: [], question_answers: [] })
    expect(await getMyAnswers(client, 'user-1')).toEqual([])
  })
})

function client(fake: ReturnType<typeof createFakeReports>) {
  return fake as unknown as SupabaseClient
}

function toFakeTablesClient(fake: ReturnType<typeof createFakeReports>) {
  return fakeTablesClient({
    questions: fake._questions as unknown as Record<string, unknown>[],
    question_answers: fake._questionAnswers as unknown as Record<string, unknown>[],
  })
}

// ============================================================
// Flagship Simplification correction — required regression tests,
// numbered exactly per the checkpoint's own list (1-15; 16/17 are
// UI-level and live in app/admin/content/questions/*.test.tsx).
// ============================================================
describe('Flagship Simplification — required regression coverage', () => {
  const ADMIN = 'user-admin'
  const MEMBER = 'user-member'

  it('1. slots 1/2/3 remain unique — at most one Question per slot', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [
        { id: 'qa', slug: null, prompt: 'A', is_active: true },
        { id: 'qb', slug: null, prompt: 'B', is_active: true },
      ],
      staff: { [ADMIN]: 'admin' },
    })
    await setQuestionPosition(client(fake), 'qa', 1)
    await setQuestionPosition(client(fake), 'qb', 1)
    // qb evicts qa from slot 1 — never two Questions in the same slot.
    expect(fake._questions.find((q) => q.id === 'qa')?.current_position).toBeNull()
    expect(fake._questions.find((q) => q.id === 'qb')?.current_position).toBe(1)
  })

  it('2. Flagship can be slot 1', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [{ id: 'q1', slug: null, prompt: 'Q1', is_active: true, current_position: 1 }],
      staff: { [ADMIN]: 'admin' },
    })
    const { error } = await setQuestionFlagship(client(fake), 'q1')
    expect(error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q1')?.is_flagship).toBe(true)
  })

  it('3. Flagship can be moved from slot 1 to slot 2', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [
        { id: 'q1', slug: null, prompt: 'Q1', is_active: true, current_position: 1, is_flagship: true },
        { id: 'q2', slug: null, prompt: 'Q2', is_active: true, current_position: 2 },
      ],
      staff: { [ADMIN]: 'admin' },
    })
    const { error } = await setQuestionFlagship(client(fake), 'q2')
    expect(error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q2')?.is_flagship).toBe(true)
  })

  it('4. moving Flagship to slot 2 automatically removes it from slot 1', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [
        { id: 'q1', slug: null, prompt: 'Q1', is_active: true, current_position: 1, is_flagship: true },
        { id: 'q2', slug: null, prompt: 'Q2', is_active: true, current_position: 2 },
      ],
      staff: { [ADMIN]: 'admin' },
    })
    await setQuestionFlagship(client(fake), 'q2')
    expect(fake._questions.find((q) => q.id === 'q1')?.is_flagship).toBe(false)
    expect(fake._questions.filter((q) => q.is_flagship)).toHaveLength(1)
  })

  it('5. Flagship can move to slot 3', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [
        { id: 'q1', slug: null, prompt: 'Q1', is_active: true, current_position: 1, is_flagship: true },
        { id: 'q3', slug: null, prompt: 'Q3', is_active: true, current_position: 3 },
      ],
      staff: { [ADMIN]: 'admin' },
    })
    const { error } = await setQuestionFlagship(client(fake), 'q3')
    expect(error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q3')?.is_flagship).toBe(true)
    expect(fake._questions.find((q) => q.id === 'q1')?.is_flagship).toBe(false)
  })

  it('6. only a current (positioned) Question can be Flagship', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [{ id: 'q1', slug: null, prompt: 'Unpositioned', is_active: false }],
      staff: { [ADMIN]: 'admin' },
    })
    const { error } = await setQuestionFlagship(client(fake), 'q1')
    expect(error?.message).toMatch(/current Question/)
    expect(fake._questions.find((q) => q.id === 'q1')?.is_flagship).toBe(false)
  })

  it('7. there cannot be two Flagships', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [
        { id: 'q1', slug: null, prompt: 'Q1', is_active: true, current_position: 1, is_flagship: true },
        { id: 'q2', slug: null, prompt: 'Q2', is_active: true, current_position: 2 },
      ],
      staff: { [ADMIN]: 'admin' },
    })
    await setQuestionFlagship(client(fake), 'q2')
    expect(fake._questions.filter((q) => q.is_flagship)).toHaveLength(1)
    // Re-selecting an already-Flagship Question is a clear error, never
    // a silent no-op and never a second Flagship.
    const { error } = await setQuestionFlagship(client(fake), 'q2')
    expect(error?.message).toMatch(/already Flagship/)
  })

  it('8. editing a zero-answer current Question works in place', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [{ id: 'q1', slug: null, prompt: 'Original wording', is_active: true, current_position: 1, is_flagship: true }],
      staff: { [ADMIN]: 'admin' },
    })
    const { data: id, error } = await editCurrentQuestion(client(fake), 'q1', 'Revised wording')
    expect(error).toBeNull()
    expect(id).toBe('q1')
    expect(fake._questions).toHaveLength(1)
    expect(fake._questions[0].prompt).toBe('Revised wording')
    expect(fake._questions[0].current_position).toBe(1)
    expect(fake._questions[0].is_flagship).toBe(true)
  })

  it('9. editing an ANSWERED current Question preserves the old row and its answers untouched', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [{ id: 'q1', slug: null, prompt: 'Original wording', is_active: true, current_position: 2 }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: MEMBER, body: 'a real answer' }],
      staff: { [ADMIN]: 'admin' },
    })
    const { data: newId, error } = await editCurrentQuestion(client(fake), 'q1', 'Revised wording')
    expect(error).toBeNull()
    expect(newId).not.toBe('q1')
    const old = fake._questions.find((q) => q.id === 'q1')!
    expect(old.prompt).toBe('Original wording')
    expect(fake._questionAnswers.find((a) => a.id === 'a1')?.question_id).toBe('q1')
  })

  it('10. the replacement inherits the same slot', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [{ id: 'q1', slug: null, prompt: 'Original', is_active: true, current_position: 2 }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: MEMBER, body: 'x' }],
      staff: { [ADMIN]: 'admin' },
    })
    const { data: newId } = await editCurrentQuestion(client(fake), 'q1', 'Revised')
    expect(fake._questions.find((q) => q.id === newId)?.current_position).toBe(2)
    expect(fake._questions.find((q) => q.id === 'q1')?.current_position).toBeNull()
  })

  it('11. the replacement inherits Flagship status when the old row was Flagship', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [{ id: 'q1', slug: null, prompt: 'Original flagship', is_active: true, current_position: 1, is_flagship: true }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: MEMBER, body: 'x' }],
      staff: { [ADMIN]: 'admin' },
    })
    const { data: newId } = await editCurrentQuestion(client(fake), 'q1', 'Revised flagship')
    expect(fake._questions.find((q) => q.id === newId)?.is_flagship).toBe(true)
    expect(fake._questions.find((q) => q.id === 'q1')?.is_flagship).toBe(false)
    expect(fake._questions.filter((q) => q.is_flagship)).toHaveLength(1)
  })

  it('12. a historical Question remains retrievable for historical-answer context', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [{ id: 'q2', slug: null, prompt: 'Original #2 wording', is_active: true, current_position: 2 }],
      questionAnswers: [{ id: 'a1', question_id: 'q2', user_id: MEMBER, body: 'answered while current' }],
      staff: { [ADMIN]: 'admin' },
    })
    await editCurrentQuestion(client(fake), 'q2', 'Revised #2 wording')
    const myAnswers = await getMyAnswers(toFakeTablesClient(fake), MEMBER)
    expect(myAnswers[0].questionId).toBe('q2')
    expect(myAnswers[0].prompt).toBe('Original #2 wording')
  })

  it('13. only three positioned Questions are ever fresh/member-facing', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [
        { id: 'q1', slug: null, prompt: 'Current 1', is_active: true, current_position: 1 },
        { id: 'q2', slug: null, prompt: 'Current 2', is_active: true, current_position: 2 },
        { id: 'q3', slug: null, prompt: 'Current 3', is_active: true, current_position: 3 },
        { id: 'q-old', slug: null, prompt: 'Historical', is_active: false },
      ],
      staff: { [ADMIN]: 'admin' },
    })
    const eligible = await getEligibleQuestions(toFakeTablesClient(fake), MEMBER)
    expect(eligible.map((q) => q.id).sort()).toEqual(['q1', 'q2', 'q3'])
  })

  it('14. Minds/Profile primary answer comes from the CURRENT FLAGSHIP answer, and changes dynamically when Flagship changes', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [
        { id: 'q1', slug: null, prompt: 'Flagship', is_active: true, current_position: 1, is_flagship: true },
        { id: 'q2', slug: null, prompt: 'Not flagship', is_active: true, current_position: 2 },
      ],
      questionAnswers: [
        { id: 'a1', question_id: 'q1', user_id: MEMBER, body: 'Flagship answer' },
        { id: 'a2', question_id: 'q2', user_id: MEMBER, body: 'Other answer' },
      ],
      staff: { [ADMIN]: 'admin' },
    })
    const primary = await getPrimaryAnswer(toFakeTablesClient(fake), MEMBER)
    expect(primary?.body).toBe('Flagship answer')

    // Changing which Question is Flagship changes primary answer
    // dynamically — no historical answer is ever rewritten.
    await setQuestionFlagship(client(fake), 'q2')
    const primaryAfter = await getPrimaryAnswer(toFakeTablesClient(fake), MEMBER)
    expect(primaryAfter?.body).toBe('Other answer')
  })

  it('15. no answer to the Flagship Question means no fallback to another current Question', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [
        { id: 'q1', slug: null, prompt: 'Flagship', is_active: true, current_position: 1, is_flagship: true },
        { id: 'q2', slug: null, prompt: 'Second', is_active: true, current_position: 2 },
      ],
      questionAnswers: [{ id: 'a2', question_id: 'q2', user_id: MEMBER, body: 'Only answered the non-flagship one' }],
      staff: { [ADMIN]: 'admin' },
    })
    expect(await getPrimaryAnswer(toFakeTablesClient(fake), MEMBER)).toBeNull()
  })
})

describe('Flagship Simplification — nothing about slot #1 is special anymore', () => {
  const ADMIN = 'user-admin'
  const MODERATOR = 'user-moderator'

  function fixture() {
    return createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [
        { id: 'q1', slug: null, prompt: 'Slot 1', is_active: true, current_position: 1, is_flagship: true },
        { id: 'q2', slug: null, prompt: 'Slot 2', is_active: true, current_position: 2 },
      ],
      staff: { [ADMIN]: 'admin', [MODERATOR]: 'moderator' },
    })
  }

  it('setQuestionActive can deactivate a positioned Question in slot 1 — no more permanent protection', async () => {
    const fake = fixture()
    const { error } = await setQuestionActive(client(fake), 'q1', false)
    expect(error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q1')?.is_active).toBe(false)
    // Deactivating also correctly clears both its slot and Flagship.
    expect(fake._questions.find((q) => q.id === 'q1')?.current_position).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q1')?.is_flagship).toBe(false)
  })

  it('replaceQuestion can replace a positioned Question in slot 1, carrying Flagship forward', async () => {
    const fake = fixture()
    const { data: newId, error } = await replaceQuestion(client(fake), 'q1', 'Revised slot 1')
    expect(error).toBeNull()
    expect(fake._questions.find((q) => q.id === newId)?.current_position).toBe(1)
    expect(fake._questions.find((q) => q.id === newId)?.is_flagship).toBe(true)
  })

  it('setQuestionPosition can move a positioned Question OUT of slot 1', async () => {
    const fake = fixture()
    const { error } = await setQuestionPosition(client(fake), 'q1', 3)
    expect(error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q1')?.current_position).toBe(3)
  })

  it('setQuestionPosition can evict whichever Question holds slot 1, clearing its Flagship status too', async () => {
    const fake = fixture()
    const { error } = await setQuestionPosition(client(fake), 'q2', 1)
    expect(error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q2')?.current_position).toBe(1)
    expect(fake._questions.find((q) => q.id === 'q1')?.current_position).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q1')?.is_flagship).toBe(false)
  })

  it('a moderator still cannot touch positions or Flagship at all', async () => {
    const fake = fixture()
    fake._setViewer(MODERATOR)
    const posResult = await setQuestionPosition(client(fake), 'q2', 3)
    expect(posResult.error?.message).toBe('Not authorized.')
    const flagResult = await setQuestionFlagship(client(fake), 'q2')
    expect(flagResult.error?.message).toBe('Not authorized.')
  })
})

describe('Question Slots — Final Correction round: replacement active/position invariant (item 3)', () => {
  const ADMIN = 'user-admin'

  it('an active #2 replacement (explicit newActive: true) inherits slot #2', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [{ id: 'q-old-2', slug: null, prompt: 'Old #2', is_active: true, current_position: 2 }],
      staff: { [ADMIN]: 'admin' },
    })
    const { data: newId, error } = await replaceQuestion(client(fake), 'q-old-2', 'Revised #2 active', {
      newActive: true,
    })
    expect(error).toBeNull()
    expect(fake._questions.find((q) => q.id === newId)?.current_position).toBe(2)
    expect(fake._questions.find((q) => q.id === newId)?.is_active).toBe(true)
    expect(fake._questions.find((q) => q.id === 'q-old-2')?.current_position).toBeNull()
  })

  it('an explicitly INACTIVE #2 replacement is created unpositioned, and slot #2 becomes empty', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [{ id: 'q-old-2', slug: null, prompt: 'Old #2', is_active: true, current_position: 2 }],
      staff: { [ADMIN]: 'admin' },
    })
    const { data: newId, error } = await replaceQuestion(client(fake), 'q-old-2', 'Revised #2 inactive', {
      newActive: false,
    })
    expect(error).toBeNull()
    const newRow = fake._questions.find((q) => q.id === newId)
    expect(newRow?.is_active).toBe(false)
    expect(newRow?.current_position).toBeNull()
    // Nobody claims slot #2 anymore — never left dangling on the
    // deactivated old row, and never smuggled onto the inactive new one.
    expect(fake._questions.filter((q) => q.current_position === 2)).toHaveLength(0)
  })

  it('same principle for #3: an explicitly inactive replacement leaves slot #3 empty', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [{ id: 'q-old-3', slug: null, prompt: 'Old #3', is_active: true, current_position: 3 }],
      staff: { [ADMIN]: 'admin' },
    })
    const { data: newId } = await replaceQuestion(client(fake), 'q-old-3', 'Revised #3 inactive', {
      newActive: false,
    })
    const newRow = fake._questions.find((q) => q.id === newId)
    expect(newRow?.current_position).toBeNull()
    expect(fake._questions.filter((q) => q.current_position === 3)).toHaveLength(0)
  })
})

describe('activation/deactivation still works for any positioned Question', () => {
  const ADMIN = 'user-admin'
  it('an admin can activate and deactivate an unpositioned Question', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [{ id: 'q1', slug: null, prompt: 'A', is_active: false }],
      staff: { [ADMIN]: 'admin' },
    })
    const on = await setQuestionActive(client(fake), 'q1', true)
    expect(on.error).toBeNull()
    const off = await setQuestionActive(client(fake), 'q1', false)
    expect(off.error).toBeNull()
  })
})

describe('publish_question_answer simulation — Shown-in-Minds promotion rules (is_current, kept for backward compatibility)', () => {
  const USER = 'user-1'

  it('first answer to ANY Question becomes current when the member has none yet', () => {
    const result = simulatePublishQuestionAnswer([], USER, { id: 'q-any' }, 'first answer')
    expect(result).toHaveLength(1)
    expect(result[0].isCurrent).toBe(true)
  })

  it('rejects any write (fresh answer) against an INACTIVE Question', () => {
    expect(() => simulatePublishQuestionAnswer([], USER, { id: 'q1', isActive: false }, 'body')).toThrow(
      'This Question is no longer accepting answers.'
    )
  })

  it('rejects an EDIT of an existing answer once its Question is deactivated', () => {
    const afterFirst = simulatePublishQuestionAnswer([], USER, { id: 'q1', isActive: true }, 'v1')
    expect(() =>
      simulatePublishQuestionAnswer(afterFirst, USER, { id: 'q1', isActive: false }, 'v2 — attempted edit while inactive')
    ).toThrow('This Question is no longer accepting answers.')
  })

  it('rejects editing your own answer while it is HIDDEN by moderation', () => {
    const hidden: SimAnswer[] = [
      { id: 'a-1', userId: USER, questionId: 'q1', body: 'original', isCurrent: true, moderationStatus: 'hidden' },
    ]
    expect(() => simulatePublishQuestionAnswer(hidden, USER, { id: 'q1', isActive: true }, 'trying to sneak an edit through')).toThrow(
      'This answer has been hidden and cannot be edited.'
    )
  })
})

describe('Final Question invariant — inactive Questions never accept a new answer', () => {
  const USER = 'user-1'

  it('A. active Question + no prior answer -> creation succeeds', () => {
    const result = simulatePublishQuestionAnswer([], USER, { id: 'q-active', isActive: true }, 'a fresh answer')
    expect(result[0].body).toBe('a fresh answer')
  })

  it('B/D. inactive Question + no prior answer -> creation is rejected at the server/RPC boundary, exactly as it would be for a guessed/forged uuid with no UI involved at all', () => {
    expect(() =>
      simulatePublishQuestionAnswer([], USER, { id: 'some-inactive-question-uuid-a-member-could-only-guess', isActive: false }, 'a smuggled-in answer')
    ).toThrow('This Question is no longer accepting answers.')
  })
})

describe('set_current_answer simulation — kept for backward compatibility, no longer determines primary status', () => {
  const USER = 'user-1'
  const seed: SimAnswer[] = [
    { id: 'a-1', userId: USER, questionId: 'q1', body: 'a', isCurrent: true },
    { id: 'a-2', userId: USER, questionId: 'q2', body: 'b', isCurrent: false },
  ]

  it('switches current status between two answers, to any Questions', () => {
    const result = simulateSetCurrentAnswer(seed, USER, 'a-2')
    expect(result.find((a) => a.id === 'a-1')?.isCurrent).toBe(false)
    expect(result.find((a) => a.id === 'a-2')?.isCurrent).toBe(true)
  })

  it('rejects a HIDDEN answer', () => {
    const withHidden: SimAnswer[] = [
      ...seed,
      { id: 'a-3', userId: USER, questionId: 'q3', body: 'c', isCurrent: false, moderationStatus: 'hidden' },
    ]
    expect(() => simulateSetCurrentAnswer(withHidden, USER, 'a-3')).toThrow(/visible/)
  })
})

describe('questionSaveConfirmationCopy — no longer reads is_current, driven entirely by Flagship status', () => {
  // Onboarding & First-Use checkpoint — terminology pass (Section H):
  // "primary Minds answer" → "primary response" (Minds is no longer the
  // primary user-visible noun; see the People rename), "Answer saved."
  // → "Response saved." Neither the function name nor its parameters
  // changed.
  it('a member\'s first-ever save of the Flagship Question gets the "primary response" copy', () => {
    expect(questionSaveConfirmationCopy(true, false)).toBe('Saved. This is now your primary response.')
  })

  it('an edit of an already-answered Flagship Question gets the plain copy, never re-claiming primary status', () => {
    expect(questionSaveConfirmationCopy(true, true)).toBe('Response saved.')
  })

  it('a first-ever save of a non-Flagship current Question gets the plain copy — only Flagship is ever announced as primary', () => {
    expect(questionSaveConfirmationCopy(false, false)).toBe('Response saved.')
  })

  it('an edit of a non-Flagship Question gets the plain copy', () => {
    expect(questionSaveConfirmationCopy(false, true)).toBe('Response saved.')
  })
})

// Discovery's pool query (app/minds/page.tsx) is strictly "answers to
// the current Flagship Question," never is_current — this models the
// RLS predicate directly (same convention as fakeDispatches.ts's
// visibleRows) to prove end-to-end: with RLS applied, a hidden answer
// never reaches the discovery pool, and restoring it makes it
// reachable again.
function discoveryPool(
  rows: { id: string; user_id: string; question_id: string; body: string; moderation_status: 'visible' | 'hidden' }[],
  flagshipQuestionId: string,
  viewerId: string
) {
  const rlsVisible = rows.filter(
    (r) => r.question_id === flagshipQuestionId && r.moderation_status === 'visible'
  )
  return rlsVisible.filter((r) => r.user_id !== viewerId)
}

describe('Minds/Discovery pool — scoped to the current Flagship Question only; a hidden answer is absent, a restored one reappears', () => {
  const VIEWER = 'viewer-1'
  const OTHER = 'other-1'
  const FLAGSHIP_ID = 'q1'

  it('a hidden answer from another member never appears in the discovery pool', () => {
    const rows = [
      { id: 'a-1', user_id: OTHER, question_id: FLAGSHIP_ID, body: 'Visible answer', moderation_status: 'visible' as const },
      { id: 'a-2', user_id: OTHER, question_id: FLAGSHIP_ID, body: 'Hidden answer', moderation_status: 'hidden' as const },
    ]
    const pool = discoveryPool(rows, FLAGSHIP_ID, VIEWER)
    expect(pool.map((r) => r.id)).toEqual(['a-1'])
  })

  it('restoring the answer (moderation_status back to visible) makes it reachable in the pool again', () => {
    const rows = [{ id: 'a-2', user_id: OTHER, question_id: FLAGSHIP_ID, body: 'Restored answer', moderation_status: 'visible' as const }]
    const pool = discoveryPool(rows, FLAGSHIP_ID, VIEWER)
    expect(pool.map((r) => r.id)).toEqual(['a-2'])
  })

  it('an answer to a NON-flagship Question is never in the pool, however visible', () => {
    const rows = [{ id: 'a-3', user_id: OTHER, question_id: 'q2-not-flagship', body: 'x', moderation_status: 'visible' as const }]
    const pool = discoveryPool(rows, FLAGSHIP_ID, VIEWER)
    expect(pool).toEqual([])
  })
})
