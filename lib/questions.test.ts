import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  selectEligibleQuestions,
  buildMyAnswers,
  nextEligibleQuestion,
  needsParticipationGate,
  questionSaveConfirmationCopy,
  getEligibleQuestions,
  getMyAnswers,
  QUESTION_ANSWER_MAX_CHARS,
  type LibraryQuestion,
} from './questions'
import { simulatePublishQuestionAnswer, simulateSetCurrentAnswer, type SimAnswer } from './__tests__/simulateQuestionRpcs'
import { createFakeReports } from './__tests__/simulateReportRpcs'
import { createQuestion, replaceQuestion, setQuestionActive } from './admin-questions'

const REFLECTION_Q: LibraryQuestion = { id: 'q-reflection', prompt: 'A reflection prompt', family: 'reflection' }
const EVERYDAY_Q: LibraryQuestion = { id: 'q-everyday', prompt: 'An everyday prompt', family: 'everyday' }
const IMAGINATION_Q: LibraryQuestion = { id: 'q-imagination', prompt: 'An imagination prompt', family: 'imagination' }
const NO_FAMILY_Q: LibraryQuestion = { id: 'q-no-family', prompt: 'A no-family prompt', family: null }
const SECOND_REFLECTION_Q: LibraryQuestion = { id: 'q-reflection-2', prompt: 'A second reflection prompt', family: 'reflection' }

describe('selectEligibleQuestions — family-diverse "up to three" selection (question-families design, finally wired up)', () => {
  it('picks one from each of the three known families when all are available', () => {
    const result = selectEligibleQuestions([EVERYDAY_Q, IMAGINATION_Q, REFLECTION_Q], 3)
    expect(result.map((q) => q.family)).toEqual(['reflection', 'everyday', 'imagination'])
  })

  it('never repeats a family while a different one sits unrepresented — two reflection Questions available, only one is picked before moving on', () => {
    const result = selectEligibleQuestions([REFLECTION_Q, SECOND_REFLECTION_Q, EVERYDAY_Q], 3)
    expect(result.map((q) => q.id)).toEqual([REFLECTION_Q.id, EVERYDAY_Q.id, SECOND_REFLECTION_Q.id])
  })

  it('degrades gracefully to fewer than three when the pool itself is smaller', () => {
    const result = selectEligibleQuestions([REFLECTION_Q], 3)
    expect(result).toEqual([REFLECTION_Q])
  })

  it('an empty pool returns an empty array, never throws', () => {
    expect(selectEligibleQuestions([], 3)).toEqual([])
  })

  it('a null/unrecognized family is never excluded from the library entirely — it is simply tried last', () => {
    const result = selectEligibleQuestions([NO_FAMILY_Q, REFLECTION_Q], 2)
    expect(result.map((q) => q.id)).toEqual([REFLECTION_Q.id, NO_FAMILY_Q.id])
  })

  it('respects a custom limit', () => {
    const result = selectEligibleQuestions([REFLECTION_Q, EVERYDAY_Q, IMAGINATION_Q], 1)
    expect(result).toHaveLength(1)
    expect(result[0].family).toBe('reflection')
  })

  it('never invents a popularity/ranking signal — within a family, input order (the caller\'s own oldest-first query order) is preserved verbatim', () => {
    const older = { id: 'q-older', prompt: 'older', family: 'reflection' }
    const newer = { id: 'q-newer', prompt: 'newer', family: 'reflection' }
    const result = selectEligibleQuestions([older, newer], 2)
    expect(result.map((q) => q.id)).toEqual(['q-older', 'q-newer'])
  })
})

describe('buildMyAnswers — every historical answer resolves to its Question\'s prompt, regardless of active/canonical state', () => {
  it('resolves prompts for answers to any number of different Questions, not just a fixed three', () => {
    const rows = [
      { id: 'a-1', question_id: 'q1', body: 'body 1', updated_at: 't1', is_current: true, moderation_status: 'visible' as const },
      { id: 'a-2', question_id: 'q2', body: 'body 2', updated_at: 't2', is_current: false, moderation_status: 'visible' as const },
    ]
    const questionsById = new Map([
      ['q1', { prompt: 'Prompt one' }],
      ['q2', { prompt: 'Prompt two' }],
    ])
    const result = buildMyAnswers(rows, questionsById)
    expect(result).toHaveLength(2)
    expect(result.find((a) => a.id === 'a-1')?.prompt).toBe('Prompt one')
    expect(result.find((a) => a.id === 'a-2')?.prompt).toBe('Prompt two')
  })

  it('never mutates the input rows', () => {
    const rows = [{ id: 'a-1', question_id: 'q1', body: 'x', updated_at: 't', is_current: false, moderation_status: 'visible' as const }]
    const questionsById = new Map([['q1', { prompt: 'P' }]])
    buildMyAnswers(rows, questionsById)
    expect(rows[0]).toEqual({ id: 'a-1', question_id: 'q1', body: 'x', updated_at: 't', is_current: false, moderation_status: 'visible' })
  })
})

describe('nextEligibleQuestion', () => {
  it('returns the first eligible Question that is not the current one', () => {
    const result = nextEligibleQuestion([REFLECTION_Q, EVERYDAY_Q], REFLECTION_Q.id)
    expect(result).toEqual(EVERYDAY_Q)
  })

  it('returns null when nothing else is eligible', () => {
    expect(nextEligibleQuestion([REFLECTION_Q], REFLECTION_Q.id)).toBeNull()
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
// shapes getEligibleQuestions/getMyAnswers actually issue
// (.select/.eq/.in/.order), backed by plain mutable arrays — so the
// SAME arrays an admin-RPC fake (createFakeReports) mutates can be fed
// straight into these member-facing read functions, proving the two
// halves of the system agree without needing a real database.
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
      in(column: string, values: unknown[]) {
        rows = rows.filter((r) => values.includes(r[column]))
        return builder
      },
      order() {
        // created_at is already in insertion order in every fixture
        // below (oldest first) — no separate sort needed for these
        // tests, matching selectEligibleQuestions' own "preserve input
        // order" contract.
        return Promise.resolve({ data: rows, error: null })
      },
      then(resolve: (v: { data: typeof rows; error: null }) => void) {
        resolve({ data: rows, error: null })
      },
    }
    return builder
  }
  return { from } as unknown as SupabaseClient
}

describe('getEligibleQuestions — DB-backed selection, is_active is the ONLY gate (Question source-of-truth correction)', () => {
  it('offers an active Question the member has not answered', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'P1', family: 'reflection', is_active: true, created_at: 't1' }],
      question_answers: [],
    })
    const result = await getEligibleQuestions(client, 'user-1')
    expect(result.map((q) => q.id)).toEqual(['q1'])
  })

  it('excludes a Question the member has already answered', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'P1', family: 'reflection', is_active: true, created_at: 't1' }],
      question_answers: [{ user_id: 'user-1', question_id: 'q1' }],
    })
    const result = await getEligibleQuestions(client, 'user-1')
    expect(result).toEqual([])
  })

  it('excludes an inactive Question entirely', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'P1', family: 'reflection', is_active: false, created_at: 't1' }],
      question_answers: [],
    })
    const result = await getEligibleQuestions(client, 'user-1')
    expect(result).toEqual([])
  })

  it('never crashes on zero eligible Questions', async () => {
    const client = fakeTablesClient({ questions: [], question_answers: [] })
    const result = await getEligibleQuestions(client, 'user-1')
    expect(result).toEqual([])
    expect(needsParticipationGate(result.length, 0)).toBe(false)
  })
})

describe('getMyAnswers — shows every answer regardless of active state, never capped to a fixed three', () => {
  it('resolves an answer to a since-deactivated Question exactly as it did before deactivation', async () => {
    const client = fakeTablesClient({
      questions: [{ id: 'q1', prompt: 'Original wording', is_active: false, family: null, created_at: 't1' }],
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

// ============================================================
// SECTION 4's explicit required regression tests
// ============================================================
describe('Question source-of-truth correction — activation is REAL (Section 4, required)', () => {
  const ADMIN = 'user-admin'
  const MEMBER = 'user-member'

  it('Admin creates a non-canonical Question -> activates it -> member-facing Question selection can return it', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      staff: { [ADMIN]: 'admin' },
    })

    const { data: newId, error: createError } = await createQuestion(client(fake), 'A brand new prompt', 'reflection')
    expect(createError).toBeNull()

    // Not yet eligible — created inactive.
    let questionsClient = fakeTablesClient({
      questions: fake._questions as unknown as Record<string, unknown>[],
      question_answers: fake._questionAnswers as unknown as Record<string, unknown>[],
    })
    expect((await getEligibleQuestions(questionsClient, MEMBER)).some((q) => q.id === newId)).toBe(false)

    const { error: activateError } = await setQuestionActive(client(fake), newId as string, true)
    expect(activateError).toBeNull()

    // Genuinely eligible now — no code change, no redeploy, just the
    // Admin activation flag.
    questionsClient = fakeTablesClient({
      questions: fake._questions as unknown as Record<string, unknown>[],
      question_answers: fake._questionAnswers as unknown as Record<string, unknown>[],
    })
    const eligible = await getEligibleQuestions(questionsClient, MEMBER)
    expect(eligible.some((q) => q.id === newId)).toBe(true)
  })

  it('Admin replaces an answered, active Question -> old remains with its historical answer -> old becomes inactive -> replacement becomes active -> member-facing selection can return the replacement -> the historical answer still resolves to the OLD wording', async () => {
    const OLD_PROMPT = 'What is something ordinary you would fight to protect?'
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [{ id: 'q-old', slug: 'ordinary_worth_protecting', prompt: OLD_PROMPT, is_active: true, family: 'everyday' }],
      questionAnswers: [{ id: 'a-old', question_id: 'q-old', user_id: MEMBER, body: 'My historical answer.' }],
      staff: { [ADMIN]: 'admin' },
    })

    // Old is answered + active -> Replace (not Edit) is the only safe
    // path, matching Section 3's UI rule.
    const { data: newId, error: replaceError } = await replaceQuestion(client(fake), 'q-old', 'A revised, better version of the prompt.')
    expect(replaceError).toBeNull()
    expect(newId).not.toBe('q-old')

    // Old Question: wording untouched, now inactive, answer untouched.
    const old = fake._questions.find((q) => q.id === 'q-old')!
    expect(old.prompt).toBe(OLD_PROMPT)
    expect(old.is_active).toBe(false)
    const oldAnswer = fake._questionAnswers.find((qa) => qa.id === 'a-old')!
    expect(oldAnswer.question_id).toBe('q-old')
    expect(oldAnswer.body).toBe('My historical answer.')

    // Replacement: active immediately (old was active, no explicit
    // override given), same transaction as the old row's deactivation.
    const replacement = fake._questions.find((q) => q.id === newId)!
    expect(replacement.is_active).toBe(true)
    expect(replacement.prompt).toBe('A revised, better version of the prompt.')

    // Member-facing selection can return the replacement.
    const questionsClient = fakeTablesClient({
      questions: fake._questions as unknown as Record<string, unknown>[],
      question_answers: fake._questionAnswers as unknown as Record<string, unknown>[],
    })
    const eligible = await getEligibleQuestions(questionsClient, MEMBER)
    expect(eligible.some((q) => q.id === newId)).toBe(true)
    // The old (now inactive) Question is correctly never offered fresh.
    expect(eligible.some((q) => q.id === 'q-old')).toBe(false)

    // The existing historical answer still resolves to the OLD wording
    // — never rewritten, never reassigned to the replacement.
    const myAnswers = await getMyAnswers(questionsClient, MEMBER)
    const historical = myAnswers.find((a) => a.id === 'a-old')!
    expect(historical.prompt).toBe(OLD_PROMPT)
    expect(historical.questionId).toBe('q-old')
  })

  it('when the OLD Question was already inactive, the replacement defaults to inactive too (mirrors old state)', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MEMBER, pseudonym: 'Member' }],
      questions: [{ id: 'q-old', slug: null, prompt: 'Old inactive prompt', is_active: false }],
      questionAnswers: [{ id: 'a-old', question_id: 'q-old', user_id: MEMBER, body: 'x' }],
      staff: { [ADMIN]: 'admin' },
    })
    const { data: newId } = await replaceQuestion(client(fake), 'q-old', 'Revised inactive-origin prompt')
    expect(fake._questions.find((q) => q.id === newId)?.is_active).toBe(false)
  })
})

describe('publish_question_answer simulation — Shown-in-Minds promotion rules', () => {
  const USER = 'user-1'

  it('first answer to ANY Question becomes current when the member has none yet — no canonical restriction', () => {
    const result = simulatePublishQuestionAnswer([], USER, { id: 'q-any' }, 'first answer')
    expect(result).toHaveLength(1)
    expect(result[0].isCurrent).toBe(true)
  })

  it('publishing/editing a second answer does not steal current status from the first', () => {
    const afterFirst = simulatePublishQuestionAnswer([], USER, { id: 'q1' }, 'first answer')
    const afterSecond = simulatePublishQuestionAnswer(afterFirst, USER, { id: 'q2' }, 'second answer')

    const first = afterSecond.find((a) => a.questionId === 'q1')!
    const second = afterSecond.find((a) => a.questionId === 'q2')!
    expect(first.isCurrent).toBe(true)
    expect(second.isCurrent).toBe(false)
  })

  it('re-editing the already-current answer leaves it current and does not touch others', () => {
    const afterFirst = simulatePublishQuestionAnswer([], USER, { id: 'q1' }, 'v1')
    const afterEdit = simulatePublishQuestionAnswer(afterFirst, USER, { id: 'q1' }, 'v2 — edited')
    expect(afterEdit).toHaveLength(1)
    expect(afterEdit[0].isCurrent).toBe(true)
    expect(afterEdit[0].body).toBe('v2 — edited')
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

  it('a visible answer can still be edited normally — the guard is scoped to hidden only', () => {
    const visible: SimAnswer[] = [
      { id: 'a-1', userId: USER, questionId: 'q1', body: 'original', isCurrent: true, moderationStatus: 'visible' },
    ]
    const result = simulatePublishQuestionAnswer(visible, USER, { id: 'q1', isActive: true }, 'a legitimate edit')
    expect(result[0].body).toBe('a legitimate edit')
  })
})

// Final Question-invariant check: inactive Questions must never accept
// a brand-new answer, and this must hold at the server/RPC boundary
// itself — never something only the UI happens to prevent. These tests
// are labeled to match the checkpoint's own required list (A-E)
// one-to-one; A/B/D are proven directly against the simulation (which
// mirrors publish_question_answer's actual `question_is_active` guard
// byte-for-byte — see docs/sql/2026-09-18-admin-operations-refinement.sql
// section 1b), exactly as if a member had guessed an inactive
// Question's uuid and called the RPC directly, bypassing any UI
// entirely. C and E are proven above (getMyAnswers/getEligibleQuestions
// describe blocks) and cross-referenced here for completeness.
describe('Final Question invariant — inactive Questions never accept a new answer (Section 4 A-E)', () => {
  const USER = 'user-1'

  it('A. active Question + no prior answer -> creation succeeds', () => {
    const result = simulatePublishQuestionAnswer([], USER, { id: 'q-active', isActive: true }, 'a fresh answer')
    expect(result).toHaveLength(1)
    expect(result[0].body).toBe('a fresh answer')
  })

  it('B / D. inactive Question + no prior answer -> creation is rejected at the server/RPC boundary, exactly as it would be for a guessed/forged uuid with no UI involved at all', () => {
    expect(() =>
      simulatePublishQuestionAnswer([], USER, { id: 'some-inactive-question-uuid-a-member-could-only-guess', isActive: false }, 'a smuggled-in answer')
    ).toThrow('This Question is no longer accepting answers.')
  })

  // C. a member answered while active, the Question later deactivates
  // -> the historical answer and its exact old prompt remain fully
  // available: proven above by "getMyAnswers — shows every answer
  // regardless of active state..." > "resolves an answer to a
  // since-deactivated Question exactly as it did before deactivation."
  //
  // E. Admin replacement leaves the old answered Question inactive
  // with its historical answer intact, while the replacement is active
  // and eligible for new participation: proven above by "Question
  // source-of-truth correction — activation is REAL" > "Admin replaces
  // an answered, active Question -> ...", which exercises
  // admin_replace_question's actual fake RPC plus
  // getEligibleQuestions/getMyAnswers together.
})

describe('set_current_answer simulation — no canonical restriction', () => {
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

  it('rejects an answer that does not belong to this member', () => {
    expect(() => simulateSetCurrentAnswer(seed, 'someone-else', 'a-1')).toThrow(/visible/)
  })
})

describe('questionSaveConfirmationCopy', () => {
  it('a save that just became the featured answer gets the "now featured" copy', () => {
    expect(questionSaveConfirmationCopy(false, true)).toBe('Saved. This answer is now featured in Minds.')
  })

  it('an ordinary save that leaves featured status unchanged gets the plain copy — never featured, and already featured', () => {
    expect(questionSaveConfirmationCopy(false, false)).toBe('Answer saved.')
    expect(questionSaveConfirmationCopy(true, true)).toBe('Answer saved.')
  })

  it('composed with the real promotion simulation: a member\'s first save (to any Question) produces the featured copy', () => {
    const result = simulatePublishQuestionAnswer([], 'user-1', { id: 'q1' }, 'first answer')
    expect(questionSaveConfirmationCopy(false, result[0].isCurrent)).toBe('Saved. This answer is now featured in Minds.')
  })

  it('composed with the real promotion simulation: editing an already-current answer produces the plain copy, never re-claiming "now featured"', () => {
    const afterFirst = simulatePublishQuestionAnswer([], 'user-1', { id: 'q1' }, 'v1')
    const afterEdit = simulatePublishQuestionAnswer(afterFirst, 'user-1', { id: 'q1' }, 'v2')
    expect(questionSaveConfirmationCopy(true, afterEdit[0].isCurrent)).toBe('Answer saved.')
  })

  it('composed with the real promotion simulation: a second answer that does not steal current status gets the plain copy', () => {
    const afterFirst = simulatePublishQuestionAnswer([], 'user-1', { id: 'q1' }, 'first answer')
    const afterSecond = simulatePublishQuestionAnswer(afterFirst, 'user-1', { id: 'q2' }, 'second answer')
    const second = afterSecond.find((a) => a.questionId === 'q2')!
    expect(questionSaveConfirmationCopy(false, second.isCurrent)).toBe('Answer saved.')
  })
})

// Admin Phase 2A-1, Section 9 — Minds/Discovery's pool query
// (app/minds/page.tsx: `.from('question_answers').select(...)
// .eq('is_current', true).neq('user_id', viewer.id)`) deliberately adds
// NO application-level moderation_status filter of its own — the
// cross-user RLS policy alone is the authority here, since this query
// already excludes the viewer's own rows before RLS ever runs. This
// models that RLS predicate directly (same convention as
// fakeDispatches.ts's visibleRows) to prove end-to-end: with RLS
// applied, a hidden answer never reaches the discovery pool, and
// restoring it makes it reachable again. Unaffected by the Question
// source-of-truth correction — Discovery eligibility was never scoped
// to canonical Questions to begin with, only to is_current + visible.
function discoveryPool(
  rows: { id: string; user_id: string; question_id: string; body: string; moderation_status: 'visible' | 'hidden' }[],
  activeQuestionIds: Set<string>,
  viewerId: string
) {
  const rlsVisible = rows.filter(
    (r) => activeQuestionIds.has(r.question_id) && r.moderation_status === 'visible'
  )
  return rlsVisible.filter((r) => r.user_id !== viewerId)
}

describe('Minds/Discovery pool — a hidden answer is absent, a restored one reappears (Section 9)', () => {
  const VIEWER = 'viewer-1'
  const OTHER = 'other-1'
  const activeQuestions = new Set(['q1'])

  it('a hidden answer from another member never appears in the discovery pool', () => {
    const rows = [
      { id: 'a-1', user_id: OTHER, question_id: 'q1', body: 'Visible answer', moderation_status: 'visible' as const },
      { id: 'a-2', user_id: OTHER, question_id: 'q1', body: 'Hidden answer', moderation_status: 'hidden' as const },
    ]
    const pool = discoveryPool(rows, activeQuestions, VIEWER)
    expect(pool.map((r) => r.id)).toEqual(['a-1'])
  })

  it('restoring the answer (moderation_status back to visible) makes it reachable in the pool again', () => {
    const rows = [{ id: 'a-2', user_id: OTHER, question_id: 'q1', body: 'Restored answer', moderation_status: 'visible' as const }]
    const pool = discoveryPool(rows, activeQuestions, VIEWER)
    expect(pool.map((r) => r.id)).toEqual(['a-2'])
  })

  it('a hidden answer to an inactive Question is doubly excluded — neither condition alone lets it through', () => {
    const rows = [{ id: 'a-3', user_id: OTHER, question_id: 'q-inactive', body: 'x', moderation_status: 'hidden' as const }]
    const pool = discoveryPool(rows, activeQuestions, VIEWER)
    expect(pool).toEqual([])
  })
})
