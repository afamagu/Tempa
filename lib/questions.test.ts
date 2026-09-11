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
import { replaceQuestion, setQuestionActive, setQuestionPosition } from './admin-questions'

const Q1: LibraryQuestion = { id: 'q-one', prompt: 'The flagship prompt', position: 1 }
const Q2: LibraryQuestion = { id: 'q-two', prompt: 'The #2 prompt', position: 2 }

describe('buildMyAnswers — every historical answer resolves to its Question\'s prompt, regardless of active/positioned state', () => {
  it('resolves prompts for answers to any number of different Questions, not just a fixed three', () => {
    const rows = [
      { id: 'a-1', question_id: 'q1', body: 'body 1', updated_at: 't1', is_current: true, moderation_status: 'visible' as const },
      { id: 'a-2', question_id: 'q2', body: 'body 2', updated_at: 't2', is_current: false, moderation_status: 'visible' as const },
    ]
    const questionsById = new Map([
      ['q1', { prompt: 'Prompt one', current_position: null }],
      ['q2', { prompt: 'Prompt two', current_position: null }],
    ])
    const result = buildMyAnswers(rows, questionsById)
    expect(result).toHaveLength(2)
    expect(result.find((a) => a.id === 'a-1')?.prompt).toBe('Prompt one')
    expect(result.find((a) => a.id === 'a-2')?.prompt).toBe('Prompt two')
  })

  it('marks isPrimary true only for the answer whose Question currently holds position 1', () => {
    const rows = [
      { id: 'a-1', question_id: 'q1', body: 'b1', updated_at: 't1', is_current: false, moderation_status: 'visible' as const },
      { id: 'a-2', question_id: 'q2', body: 'b2', updated_at: 't2', is_current: true, moderation_status: 'visible' as const },
    ]
    const questionsById = new Map([
      ['q1', { prompt: 'P1', current_position: 1 }],
      ['q2', { prompt: 'P2', current_position: 2 }],
    ])
    const result = buildMyAnswers(rows, questionsById)
    expect(result.find((a) => a.id === 'a-1')?.isPrimary).toBe(true)
    // is_current being true does NOT make it primary — only position 1 does.
    expect(result.find((a) => a.id === 'a-2')?.isPrimary).toBe(false)
  })

  it('never mutates the input rows', () => {
    const rows = [{ id: 'a-1', question_id: 'q1', body: 'x', updated_at: 't', is_current: false, moderation_status: 'visible' as const }]
    const questionsById = new Map([['q1', { prompt: 'P', current_position: null }]])
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
  it('remains 2000, unchanged by this checkpoint', () => {
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

describe('getEligibleQuestions — DB-backed, current_position is the ONLY gate (Question Slots checkpoint)', () => {
  it('offers positioned Questions in #1/#2/#3 order', async () => {
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

  it('an unpositioned (library/history) Question is never offered, even if active', async () => {
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

describe('getFlagshipQuestion / getPrimaryAnswer', () => {
  it('getFlagshipQuestion resolves whichever Question holds position 1', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'The flagship', current_position: 1, is_active: true }],
      question_answers: [],
    })
    expect(await getFlagshipQuestion(client)).toEqual({ id: 'q1', prompt: 'The flagship' })
  })

  it('getFlagshipQuestion returns null when nothing currently holds position 1', async () => {
    const client = fakeTablesClient({ questions: [], question_answers: [] })
    expect(await getFlagshipQuestion(client)).toBeNull()
  })

  it('getPrimaryAnswer resolves the member\'s own visible answer to the flagship Question', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'The flagship', current_position: 1, is_active: true }],
      question_answers: [{ id: 'a1', question_id: 'q1', user_id: 'user-1', body: 'my answer', updated_at: 't', moderation_status: 'visible' }],
    })
    const result = await getPrimaryAnswer(client, 'user-1')
    expect(result?.body).toBe('my answer')
    expect(result?.prompt).toBe('The flagship')
  })

  it('getPrimaryAnswer is null when the member has not answered the flagship — NEVER falls back to another answer', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'The flagship', current_position: 1, is_active: true }],
      question_answers: [{ id: 'a2', question_id: 'q2', user_id: 'user-1', body: 'answer to #2, not the flagship', updated_at: 't', moderation_status: 'visible' }],
    })
    expect(await getPrimaryAnswer(client, 'user-1')).toBeNull()
  })

  it('getPrimaryAnswer is null when the flagship answer is hidden by moderation', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'The flagship', current_position: 1, is_active: true }],
      question_answers: [{ id: 'a1', question_id: 'q1', user_id: 'user-1', body: 'hidden', updated_at: 't', moderation_status: 'hidden' }],
    })
    expect(await getPrimaryAnswer(client, 'user-1')).toBeNull()
  })

  it('getPrimaryAnswer is null when there is no flagship Question at all', async () => {
    const client = fakeTablesClient({ questions: [], question_answers: [] })
    expect(await getPrimaryAnswer(client, 'user-1')).toBeNull()
  })
})

describe('getMyAnswers — shows every answer regardless of active/positioned state, never capped to a fixed three', () => {
  it('resolves an answer to a since-deactivated Question exactly as it did before deactivation', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'Original wording', is_active: false, current_position: null }],
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
// PART A's required regression tests (numbered exactly per the
// checkpoint's own list)
// ============================================================
describe('Question Slots — required regression coverage', () => {
  const ADMIN = 'user-admin'
  const MEMBER = 'user-member'

  it('1/2/3. only one current Question can occupy each of position 1, 2, and 3', async () => {
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
    // Attempting to also assign qb to position 1 while qa holds it is
    // refused — flagship protection (direction 2).
    const { error } = await setQuestionPosition(client(fake), 'qb', 1)
    expect(error?.message).toMatch(/flagship/)
    expect(fake._questions.find((q) => q.id === 'qa')?.current_position).toBe(1)
    expect(fake._questions.find((q) => q.id === 'qb')?.current_position).toBeNull()

    // Position 2 and 3 are ordinary slots — assigning qb to 2 succeeds,
    // and re-assigning it to 3 later vacates 2 again (never two
    // Questions in the same slot at once).
    await setQuestionPosition(client(fake), 'qb', 2)
    expect(fake._questions.find((q) => q.id === 'qb')?.current_position).toBe(2)
    await setQuestionPosition(client(fake), 'qb', 3)
    expect(fake._questions.find((q) => q.id === 'qb')?.current_position).toBe(3)
    expect(fake._questions.filter((q) => q.current_position === 2)).toHaveLength(0)
  })

  it('4. member Question offering follows 1 -> 2 -> 3', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [
        { id: 'q1', slug: null, prompt: 'Prompt one', is_active: true, current_position: 1 },
        { id: 'q2', slug: null, prompt: 'Prompt two', is_active: true, current_position: 2 },
        { id: 'q3', slug: null, prompt: 'Prompt three', is_active: true, current_position: 3 },
      ],
      staff: { [ADMIN]: 'admin' },
    })
    const eligible = await getEligibleQuestions(toFakeTablesClient(fake), MEMBER)
    expect(eligible.map((q) => q.id)).toEqual(['q1', 'q2', 'q3'])
  })

  it('5. answered Questions remain historically attached to their exact original row', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [{ id: 'q2', slug: null, prompt: 'Original #2 wording', is_active: true, current_position: 2 }],
      questionAnswers: [{ id: 'a1', question_id: 'q2', user_id: MEMBER, body: 'answered while #2' }],
      staff: { [ADMIN]: 'admin' },
    })
    // Deactivate #2 (vacates the slot) — the answer must still resolve
    // to the exact original row/wording.
    await setQuestionActive(client(fake), 'q2', false)
    const myAnswers = await getMyAnswers(toFakeTablesClient(fake), MEMBER)
    expect(myAnswers[0].questionId).toBe('q2')
    expect(myAnswers[0].prompt).toBe('Original #2 wording')
  })

  it('6. replacing #2 preserves slot #2', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [{ id: 'q-old-2', slug: null, prompt: 'Old #2', is_active: true, current_position: 2 }],
      questionAnswers: [{ id: 'a1', question_id: 'q-old-2', user_id: MEMBER, body: 'x' }],
      staff: { [ADMIN]: 'admin' },
    })
    const { data: newId, error } = await replaceQuestion(client(fake), 'q-old-2', 'Revised #2')
    expect(error).toBeNull()
    expect(fake._questions.find((q) => q.id === newId)?.current_position).toBe(2)
    expect(fake._questions.find((q) => q.id === 'q-old-2')?.current_position).toBeNull()
  })

  it('7. replacing #3 preserves slot #3', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [{ id: 'q-old-3', slug: null, prompt: 'Old #3', is_active: true, current_position: 3 }],
      questionAnswers: [{ id: 'a1', question_id: 'q-old-3', user_id: MEMBER, body: 'x' }],
      staff: { [ADMIN]: 'admin' },
    })
    const { data: newId } = await replaceQuestion(client(fake), 'q-old-3', 'Revised #3')
    expect(fake._questions.find((q) => q.id === newId)?.current_position).toBe(3)
  })

  it('8/9. Minds uses current Question #1\'s answer, and does NOT fall back to #2/#3 when #1 is unanswered', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [
        { id: 'q1', slug: null, prompt: 'Flagship', is_active: true, current_position: 1 },
        { id: 'q2', slug: null, prompt: 'Second', is_active: true, current_position: 2 },
      ],
      questionAnswers: [{ id: 'a2', question_id: 'q2', user_id: MEMBER, body: 'Only answered #2, not #1' }],
      staff: { [ADMIN]: 'admin' },
    })
    // Answered #2 only — no #1 answer at all.
    expect(await getPrimaryAnswer(toFakeTablesClient(fake), MEMBER)).toBeNull()

    // Now answer #1 too — becomes primary.
    fake._questionAnswers.push({
      id: 'a1', question_id: 'q1', user_id: MEMBER, body: 'Answered the flagship', moderation_status: 'visible',
    })
    const primary = await getPrimaryAnswer(toFakeTablesClient(fake), MEMBER)
    expect(primary?.body).toBe('Answered the flagship')
  })

  it('10/11. profile primary answer is #1, and other answers remain accessible', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [
        { id: 'q1', slug: null, prompt: 'Flagship', is_active: true, current_position: 1 },
        { id: 'q2', slug: null, prompt: 'Second', is_active: true, current_position: 2 },
      ],
      questionAnswers: [
        { id: 'a1', question_id: 'q1', user_id: MEMBER, body: 'Primary answer' },
        { id: 'a2', question_id: 'q2', user_id: MEMBER, body: 'Other answer' },
      ],
      staff: { [ADMIN]: 'admin' },
    })
    const answers = await getMyAnswers(toFakeTablesClient(fake), MEMBER)
    const primary = answers.find((a) => a.isPrimary)
    const others = answers.filter((a) => !a.isPrimary)
    expect(primary?.body).toBe('Primary answer')
    expect(others.map((a) => a.body)).toEqual(['Other answer'])
  })

  it('12. no member-side action can arbitrarily override the flagship rule', async () => {
    const fake = createFakeReports({
      viewerId: 'user-member',
      profiles: [{ id: 'user-member', pseudonym: 'Member' }],
      questions: [
        { id: 'q1', slug: null, prompt: 'Flagship', is_active: true, current_position: 1 },
        { id: 'q2', slug: null, prompt: 'Second', is_active: true, current_position: 2 },
      ],
      questionAnswers: [
        { id: 'a1', question_id: 'q1', user_id: 'user-member', body: 'x', is_current: false },
        { id: 'a2', question_id: 'q2', user_id: 'user-member', body: 'y', is_current: true },
      ],
    })
    // A member's set_current_answer choice (is_current) is a completely
    // separate, member-choosable flag that has no bearing on primary-
    // answer status — a2 is is_current=true but is NOT positioned at 1,
    // so it must never be treated as primary.
    const answers = await getMyAnswers(toFakeTablesClient(fake), 'user-member')
    const a1 = answers.find((a) => a.id === 'a1')!
    const a2 = answers.find((a) => a.id === 'a2')!
    expect(a1.isPrimary).toBe(true)
    expect(a1.isCurrent).toBe(false)
    expect(a2.isPrimary).toBe(false)
    expect(a2.isCurrent).toBe(true)

    // Also: no is_staff('admin') check bypass — a plain member cannot
    // call the position/flagship RPCs at all.
    const { error } = await setQuestionPosition(client(fake), 'q2', 1)
    expect(error?.message).toBe('Not authorized.')
  })
})

describe('Question Slots — Admin flagship protection (Section A2)', () => {
  const ADMIN = 'user-admin'
  const MODERATOR = 'user-moderator'

  function flagshipFixture() {
    return createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }],
      questions: [
        { id: 'q1', slug: null, prompt: 'Flagship', is_active: true, current_position: 1 },
        { id: 'q2', slug: null, prompt: 'Second', is_active: true, current_position: 2 },
      ],
      staff: { [ADMIN]: 'admin', [MODERATOR]: 'moderator' },
    })
  }

  it('setQuestionActive refuses to deactivate #1', async () => {
    const fake = flagshipFixture()
    const { error } = await setQuestionActive(client(fake), 'q1', false)
    expect(error?.message).toMatch(/flagship/)
    expect(fake._questions.find((q) => q.id === 'q1')?.is_active).toBe(true)
  })

  it('replaceQuestion refuses to replace #1', async () => {
    const fake = flagshipFixture()
    const { error } = await replaceQuestion(client(fake), 'q1', 'A revised flagship wording')
    expect(error?.message).toMatch(/flagship/)
  })

  it('setQuestionPosition refuses to move #1 away', async () => {
    const fake = flagshipFixture()
    const { error } = await setQuestionPosition(client(fake), 'q1', 2)
    expect(error?.message).toMatch(/flagship/)
  })

  it('setQuestionPosition refuses to clear #1\'s position', async () => {
    const fake = flagshipFixture()
    const { error } = await setQuestionPosition(client(fake), 'q1', null)
    expect(error?.message).toMatch(/flagship/)
  })

  it('deactivating an ordinary slot (#2) is allowed and vacates it', async () => {
    const fake = flagshipFixture()
    const { error } = await setQuestionActive(client(fake), 'q2', false)
    expect(error).toBeNull()
    expect(fake._questions.find((q) => q.id === 'q2')?.current_position).toBeNull()
  })

  it('a moderator cannot touch positions at all', async () => {
    const fake = flagshipFixture()
    fake._setViewer(MODERATOR)
    const { error } = await setQuestionPosition(client(fake), 'q2', 3)
    expect(error?.message).toBe('Not authorized.')
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

describe('Question Slots — activation/deactivation still works (non-flagship)', () => {
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

describe('questionSaveConfirmationCopy — Question Slots checkpoint (no longer reads is_current)', () => {
  it('a member\'s first-ever save of the flagship (#1) Question gets the "primary Minds answer" copy', () => {
    expect(questionSaveConfirmationCopy(true, false)).toBe('Saved. This is now your primary Minds answer.')
  })

  it('an edit of an already-answered flagship Question gets the plain copy, never re-claiming primary status', () => {
    expect(questionSaveConfirmationCopy(true, true)).toBe('Answer saved.')
  })

  it('a first-ever save of #2 or #3 gets the plain copy — only #1 is ever announced as primary', () => {
    expect(questionSaveConfirmationCopy(false, false)).toBe('Answer saved.')
  })

  it('an edit of a non-flagship Question gets the plain copy', () => {
    expect(questionSaveConfirmationCopy(false, true)).toBe('Answer saved.')
  })
})

// Discovery's pool query (app/minds/page.tsx) is now strictly "answers
// to the current flagship Question," never is_current — this models
// the RLS predicate directly (same convention as fakeDispatches.ts's
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

describe('Minds/Discovery pool — scoped to the flagship Question only; a hidden answer is absent, a restored one reappears', () => {
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
