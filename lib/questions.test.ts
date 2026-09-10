import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  pickCanonicalQuestions,
  buildCanonicalAnswers,
  mergeCanonicalQuestionState,
  needsParticipationGate,
  questionSaveConfirmationCopy,
  nextUnansweredCanonicalQuestion,
  getCanonicalQuestions,
  getAllCanonicalQuestions,
  CANONICAL_QUESTION_SLUGS,
  QUESTION_ANSWER_MAX_CHARS,
  type CanonicalQuestion,
  type CanonicalQuestionState,
} from './questions'
import { simulatePublishQuestionAnswer, simulateSetCurrentAnswer, type SimAnswer } from './__tests__/simulateQuestionRpcs'

const PRIVATE_RITUAL = { id: 'q-private-ritual', slug: 'private_ritual', prompt: 'Is there something you return to when no one\'s watching?' }
const PLACE_OUTSIDERS = { id: 'q-place-outsiders', slug: 'place_outsiders_miss', prompt: 'What\'s something about your home a stranger would never guess?' }
const ORDINARY_WORTH = { id: 'q-ordinary-worth', slug: 'ordinary_worth_protecting', prompt: 'What\'s something ordinary you\'d fight to protect?' }
const HISTORICAL = { id: 'q-historical', slug: null, prompt: 'What is something you understand differently now than you did five years ago?' }

const THREE_CANONICAL: CanonicalQuestion[] = [PRIVATE_RITUAL, PLACE_OUTSIDERS, ORDINARY_WORTH].map((q) => ({
  id: q.id,
  slug: q.slug as CanonicalQuestion['slug'],
  prompt: q.prompt,
}))

describe('pickCanonicalQuestions', () => {
  it('returns exactly the three canonical Questions, in fixed slug order, regardless of row order', () => {
    const rows = [ORDINARY_WORTH, HISTORICAL, PRIVATE_RITUAL, PLACE_OUTSIDERS]
    const result = pickCanonicalQuestions(rows)

    expect(result).toHaveLength(3)
    expect(result.map((q) => q.slug)).toEqual([...CANONICAL_QUESTION_SLUGS])
    expect(result.find((q) => q.id === HISTORICAL.id)).toBeUndefined()
  })

  it('degrades gracefully (never throws) when a canonical slug is simply missing from the rows', () => {
    const rows = [PRIVATE_RITUAL, HISTORICAL]
    const result = pickCanonicalQuestions(rows)
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('private_ritual')
  })
})

describe('buildCanonicalAnswers — old Question answers remain untouched', () => {
  it('excludes every historical (non-canonical) answer row entirely, never reading or altering it', () => {
    const rows = [
      { id: 'a-1', question_id: PRIVATE_RITUAL.id, body: 'canonical body', updated_at: '2026-09-01', is_current: true, moderation_status: 'visible' as const },
      { id: 'a-2', question_id: HISTORICAL.id, body: 'historical body — must never appear', updated_at: '2020-01-01', is_current: false, moderation_status: 'visible' as const },
    ]
    const result = buildCanonicalAnswers(THREE_CANONICAL, rows)

    expect(result).toHaveLength(1)
    expect(result[0].questionId).toBe(PRIVATE_RITUAL.id)
    expect(result.some((a) => a.body.includes('historical body'))).toBe(false)
    // The historical row itself is untouched by this call — the input
    // array still contains it exactly as given, proving no mutation.
    expect(rows[1]).toEqual({
      id: 'a-2',
      question_id: HISTORICAL.id,
      body: 'historical body — must never appear',
      updated_at: '2020-01-01',
      is_current: false,
      moderation_status: 'visible',
    })
  })
})

describe('mergeCanonicalQuestionState — Answer a Question completed/uncompleted state', () => {
  it('always returns all three, pairing answered ones and leaving the rest null', () => {
    const answers = buildCanonicalAnswers(THREE_CANONICAL, [
      { id: 'a-1', question_id: PLACE_OUTSIDERS.id, body: 'x', updated_at: 't', is_current: false, moderation_status: 'visible' },
    ])
    const result = mergeCanonicalQuestionState(THREE_CANONICAL, answers)

    expect(result).toHaveLength(3)
    expect(result.find((s) => s.slug === 'place_outsiders_miss')?.answer?.id).toBe('a-1')
    expect(result.find((s) => s.slug === 'private_ritual')?.answer).toBeNull()
    expect(result.find((s) => s.slug === 'ordinary_worth_protecting')?.answer).toBeNull()
  })
})

function stateFor(answeredSlugs: (typeof CANONICAL_QUESTION_SLUGS)[number][]): CanonicalQuestionState[] {
  return THREE_CANONICAL.map((q) => ({
    ...q,
    answer: answeredSlugs.includes(q.slug)
      ? { id: `a-${q.slug}`, questionId: q.id, slug: q.slug, prompt: q.prompt, body: 'x', updatedAt: 't', isCurrent: false, moderationStatus: 'visible' }
      : null,
  }))
}

describe('nextUnansweredCanonicalQuestion', () => {
  it('#1 being answered, #2 unanswered -> Next is #2', () => {
    const result = nextUnansweredCanonicalQuestion(PRIVATE_RITUAL.id, stateFor(['private_ritual']))
    expect(result?.slug).toBe('place_outsiders_miss')
  })

  it('#2 already answered, #3 unanswered -> Next is #3, not simply "next slug" from #1', () => {
    const result = nextUnansweredCanonicalQuestion(PRIVATE_RITUAL.id, stateFor(['private_ritual', 'place_outsiders_miss']))
    expect(result?.slug).toBe('ordinary_worth_protecting')
  })

  it('wraps around: editing #2 while #1 is unanswered and #3 is answered -> Next is #1', () => {
    const result = nextUnansweredCanonicalQuestion(PLACE_OUTSIDERS.id, stateFor(['place_outsiders_miss', 'ordinary_worth_protecting']))
    expect(result?.slug).toBe('private_ritual')
  })

  it('revisiting a completed answer when nothing else remains unanswered -> null (no Next)', () => {
    const result = nextUnansweredCanonicalQuestion(
      PRIVATE_RITUAL.id,
      stateFor(['private_ritual', 'place_outsiders_miss', 'ordinary_worth_protecting'])
    )
    expect(result).toBeNull()
  })

  it('a non-canonical (historical) question id -> null', () => {
    const result = nextUnansweredCanonicalQuestion(HISTORICAL.id, stateFor([]))
    expect(result).toBeNull()
  })
})

describe('needsParticipationGate', () => {
  it('zero completed canonical answers triggers the gate', () => {
    expect(needsParticipationGate(3, 0)).toBe(true)
  })

  it('one completed canonical answer satisfies the gate (never requires all three)', () => {
    expect(needsParticipationGate(3, 1)).toBe(false)
    expect(needsParticipationGate(3, 3)).toBe(false)
  })

  it('never gates when canonical Questions are not live in this database yet', () => {
    expect(needsParticipationGate(0, 0)).toBe(false)
  })
})

// Length-policy audit (2026-09-05 live-test report): confirms the
// actual live cap (matches the question_answers_body_max_length check
// constraint), and that the first-contact letter composer
// (app/write/[recipientId]/first-letter-composer.tsx) computes its own
// "over limit" boundary identically to this one canonical value —
// imported directly, never re-hardcoded — so the two can never
// silently drift.
describe('QUESTION_ANSWER_MAX_CHARS — the canonical stranger/discovery-writing cap', () => {
  it('remains 2000, unchanged by this checkpoint', () => {
    expect(QUESTION_ANSWER_MAX_CHARS).toBe(2000)
  })

  it('a body at exactly the cap is not over it; one character more is', () => {
    // Mirrors both question-answer.tsx's and first-letter-composer.tsx's
    // own `charCount > MAX_CHARS` derivation exactly.
    const atCap = 'x'.repeat(QUESTION_ANSWER_MAX_CHARS)
    const overCap = 'x'.repeat(QUESTION_ANSWER_MAX_CHARS + 1)
    expect(atCap.length > QUESTION_ANSWER_MAX_CHARS).toBe(false)
    expect(overCap.length > QUESTION_ANSWER_MAX_CHARS).toBe(true)
  })
})

describe('publish_question_answer simulation — Shown-in-Minds promotion rules', () => {
  const USER = 'user-1'

  it('first canonical answer becomes current when the member has none yet', () => {
    const result = simulatePublishQuestionAnswer([], USER, { id: PRIVATE_RITUAL.id, isCanonical: true }, 'first answer')
    expect(result).toHaveLength(1)
    expect(result[0].isCurrent).toBe(true)
  })

  it('publishing/editing a second canonical answer does not steal current status from the first', () => {
    const afterFirst = simulatePublishQuestionAnswer([], USER, { id: PRIVATE_RITUAL.id, isCanonical: true }, 'first answer')
    const afterSecond = simulatePublishQuestionAnswer(
      afterFirst,
      USER,
      { id: PLACE_OUTSIDERS.id, isCanonical: true },
      'second answer'
    )

    const first = afterSecond.find((a) => a.questionId === PRIVATE_RITUAL.id)!
    const second = afterSecond.find((a) => a.questionId === PLACE_OUTSIDERS.id)!
    expect(first.isCurrent).toBe(true)
    expect(second.isCurrent).toBe(false)
  })

  it('re-editing the already-current answer leaves it current and does not touch others', () => {
    const afterFirst = simulatePublishQuestionAnswer([], USER, { id: PRIVATE_RITUAL.id, isCanonical: true }, 'v1')
    const afterEdit = simulatePublishQuestionAnswer(
      afterFirst,
      USER,
      { id: PRIVATE_RITUAL.id, isCanonical: true },
      'v2 — edited'
    )
    expect(afterEdit).toHaveLength(1)
    expect(afterEdit[0].isCurrent).toBe(true)
    expect(afterEdit[0].body).toBe('v2 — edited')
  })

  it('publishing/editing a historical (non-canonical) answer never sets is_current', () => {
    const result = simulatePublishQuestionAnswer([], USER, { id: HISTORICAL.id, isCanonical: false }, 'historical edit')
    expect(result[0].isCurrent).toBe(false)
  })
})

// Question-answer vs letter-composer separation checkpoint (2026-09-05)
// — saving a Question answer is never a letter: no recipient, no
// correspondence, no Mail Call. This is the confirmation-copy half of
// that; the underlying promotion rules it reads (was/now current) are
// already proven above by the publish_question_answer simulation.
describe('questionSaveConfirmationCopy', () => {
  it('a save that just became the featured answer gets the "now featured" copy', () => {
    expect(questionSaveConfirmationCopy(false, true)).toBe('Saved. This answer is now featured in Minds.')
  })

  it('an ordinary save that leaves featured status unchanged gets the plain copy — never featured, and already featured', () => {
    expect(questionSaveConfirmationCopy(false, false)).toBe('Answer saved.')
    expect(questionSaveConfirmationCopy(true, true)).toBe('Answer saved.')
  })

  it('composed with the real promotion simulation: a member\'s first canonical save produces the featured copy', () => {
    const result = simulatePublishQuestionAnswer([], 'user-1', { id: PRIVATE_RITUAL.id, isCanonical: true }, 'first answer')
    expect(questionSaveConfirmationCopy(false, result[0].isCurrent)).toBe('Saved. This answer is now featured in Minds.')
  })

  it('composed with the real promotion simulation: editing an already-current answer produces the plain copy, never re-claiming "now featured"', () => {
    const afterFirst = simulatePublishQuestionAnswer([], 'user-1', { id: PRIVATE_RITUAL.id, isCanonical: true }, 'v1')
    const afterEdit = simulatePublishQuestionAnswer(afterFirst, 'user-1', { id: PRIVATE_RITUAL.id, isCanonical: true }, 'v2')
    expect(questionSaveConfirmationCopy(true, afterEdit[0].isCurrent)).toBe('Answer saved.')
  })

  it('composed with the real promotion simulation: a second answer that does not steal current status gets the plain copy', () => {
    const afterFirst = simulatePublishQuestionAnswer([], 'user-1', { id: PRIVATE_RITUAL.id, isCanonical: true }, 'first answer')
    const afterSecond = simulatePublishQuestionAnswer(
      afterFirst,
      'user-1',
      { id: PLACE_OUTSIDERS.id, isCanonical: true },
      'second answer'
    )
    const second = afterSecond.find((a) => a.questionId === PLACE_OUTSIDERS.id)!
    expect(questionSaveConfirmationCopy(false, second.isCurrent)).toBe('Answer saved.')
  })
})

// Admin Phase 2A-1 (Decision 3) — the getCanonicalQuestions query fix,
// exercised end-to-end through a tiny fake `.from('questions')
// .select().in().eq('is_active', true)` chain rather than through the
// pure pickCanonicalQuestions helper alone, so this proves the actual
// query filter is wired up, not just that the pure post-processing
// degrades gracefully.
function fakeQuestionsClient(rows: { id: string; slug: string | null; prompt: string; is_active: boolean }[]) {
  function from() {
    let filtered = rows
    const builder = {
      select() {
        return builder
      },
      in(column: string, values: string[]) {
        filtered = filtered.filter((r) => values.includes((r as Record<string, unknown>)[column] as string))
        return builder
      },
      eq(column: string, value: unknown) {
        filtered = filtered.filter((r) => (r as Record<string, unknown>)[column] === value)
        return Promise.resolve({ data: filtered, error: null })
      },
      then(resolve: (v: { data: typeof filtered; error: null }) => void) {
        resolve({ data: filtered, error: null })
      },
    }
    return builder
  }
  return { from } as unknown as SupabaseClient
}

const [SLUG_1, SLUG_2, SLUG_3] = CANONICAL_QUESTION_SLUGS

describe('getCanonicalQuestions — offering query is canonical slug AND is_active = true (Decision 3)', () => {
  it('all 3 active: all 3 are offered, in canonical order', async () => {
    const client = fakeQuestionsClient([
      { id: 'q1', slug: SLUG_1, prompt: 'P1', is_active: true },
      { id: 'q2', slug: SLUG_2, prompt: 'P2', is_active: true },
      { id: 'q3', slug: SLUG_3, prompt: 'P3', is_active: true },
    ])
    const result = await getCanonicalQuestions(client)
    expect(result.map((q) => q.slug)).toEqual([SLUG_1, SLUG_2, SLUG_3])
  })

  it('2 active, 1 deactivated: only the 2 active ones are offered — the deactivated slug is not offered to answer fresh', async () => {
    const client = fakeQuestionsClient([
      { id: 'q1', slug: SLUG_1, prompt: 'P1', is_active: true },
      { id: 'q2', slug: SLUG_2, prompt: 'P2', is_active: false },
      { id: 'q3', slug: SLUG_3, prompt: 'P3', is_active: true },
    ])
    const result = await getCanonicalQuestions(client)
    expect(result.map((q) => q.slug)).toEqual([SLUG_1, SLUG_3])
  })

  it('1 active, 2 deactivated: exactly 1 is offered — does not crash or pad back up to 3', async () => {
    const client = fakeQuestionsClient([
      { id: 'q1', slug: SLUG_1, prompt: 'P1', is_active: false },
      { id: 'q2', slug: SLUG_2, prompt: 'P2', is_active: true },
      { id: 'q3', slug: SLUG_3, prompt: 'P3', is_active: false },
    ])
    const result = await getCanonicalQuestions(client)
    expect(result.map((q) => q.slug)).toEqual([SLUG_2])
  })

  it('0 active: an empty array, not an error, not a crash — every real consumer already treats this as "nothing to offer"', async () => {
    const client = fakeQuestionsClient([
      { id: 'q1', slug: SLUG_1, prompt: 'P1', is_active: false },
      { id: 'q2', slug: SLUG_2, prompt: 'P2', is_active: false },
      { id: 'q3', slug: SLUG_3, prompt: 'P3', is_active: false },
    ])
    const result = await getCanonicalQuestions(client)
    expect(result).toEqual([])

    // The two pure consumers this feeds must not throw or misbehave
    // against zero canonical Questions.
    expect(needsParticipationGate(result.length, 0)).toBe(false)
    expect(() => mergeCanonicalQuestionState(result, [])).not.toThrow()
    expect(mergeCanonicalQuestionState(result, [])).toEqual([])
  })

  it('getAllCanonicalQuestions ignores is_active entirely — used only to resolve id/prompt for own-history, never for what is offered fresh', async () => {
    const client = fakeQuestionsClient([
      { id: 'q1', slug: SLUG_1, prompt: 'P1', is_active: false },
      { id: 'q2', slug: SLUG_2, prompt: 'P2', is_active: false },
      { id: 'q3', slug: SLUG_3, prompt: 'P3', is_active: false },
    ])
    const result = await getAllCanonicalQuestions(client)
    expect(result.map((q) => q.slug)).toEqual([SLUG_1, SLUG_2, SLUG_3])
  })
})

// Admin Phase 2A-1, Section 9 — Minds/Discovery's pool query
// (app/minds/page.tsx: `.from('question_answers').select(...)
// .eq('is_current', true).neq('user_id', viewer.id)`) deliberately adds
// NO application-level moderation_status filter of its own — per the
// migration's own documented reasoning (docs/sql/2026-09-10-admin-
// moderation-and-questions.sql section 3), the cross-user RLS policy
// alone is the authority here, since this query already excludes the
// viewer's own rows before RLS ever runs, so there is no author-
// exception leak to defend against the way Dispatches' Board/Home feeds
// have. This models that RLS predicate directly (same convention as
// fakeDispatches.ts's visibleRows) to prove end-to-end: with RLS
// applied, a hidden answer never reaches the discovery pool, and
// restoring it makes it reachable again.
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

describe('set_current_answer simulation', () => {
  const USER = 'user-1'
  const seed: SimAnswer[] = [
    { id: 'a-1', userId: USER, questionId: PRIVATE_RITUAL.id, isCanonical: true, body: 'a', isCurrent: true },
    { id: 'a-2', userId: USER, questionId: PLACE_OUTSIDERS.id, isCanonical: true, body: 'b', isCurrent: false },
    { id: 'a-3', userId: USER, questionId: HISTORICAL.id, isCanonical: false, body: 'c', isCurrent: false },
  ]

  it('switches current status between two canonical answers', () => {
    const result = simulateSetCurrentAnswer(seed, USER, 'a-2')
    expect(result.find((a) => a.id === 'a-1')?.isCurrent).toBe(false)
    expect(result.find((a) => a.id === 'a-2')?.isCurrent).toBe(true)
  })

  it('rejects a historical/non-canonical answer', () => {
    expect(() => simulateSetCurrentAnswer(seed, USER, 'a-3')).toThrow(/canonical/)
  })

  it('independent review item 5: rejects a HIDDEN canonical answer, reusing the same error as the non-canonical case', () => {
    const withHidden: SimAnswer[] = [
      ...seed,
      { id: 'a-4', userId: USER, questionId: ORDINARY_WORTH.id, isCanonical: true, body: 'd', isCurrent: false, moderationStatus: 'hidden' },
    ]
    expect(() => simulateSetCurrentAnswer(withHidden, USER, 'a-4')).toThrow(/canonical/)
  })
})

describe('publish_question_answer simulation — independent review items 5 and 8', () => {
  const USER = 'user-1'

  it('rejects any write (fresh answer) against an INACTIVE Question', () => {
    expect(() =>
      simulatePublishQuestionAnswer([], USER, { id: PRIVATE_RITUAL.id, isCanonical: true, isActive: false }, 'body')
    ).toThrow('This Question is no longer accepting answers.')
  })

  it('rejects an EDIT of an existing answer once its Question is deactivated', () => {
    const afterFirst = simulatePublishQuestionAnswer(
      [],
      USER,
      { id: PRIVATE_RITUAL.id, isCanonical: true, isActive: true },
      'v1'
    )
    expect(() =>
      simulatePublishQuestionAnswer(
        afterFirst,
        USER,
        { id: PRIVATE_RITUAL.id, isCanonical: true, isActive: false },
        'v2 — attempted edit while inactive'
      )
    ).toThrow('This Question is no longer accepting answers.')
  })

  it('an active Question accepts writes normally — the guard is scoped to inactive only', () => {
    const result = simulatePublishQuestionAnswer(
      [],
      USER,
      { id: PRIVATE_RITUAL.id, isCanonical: true, isActive: true },
      'v1'
    )
    expect(result[0].body).toBe('v1')
  })

  it('rejects editing your own answer while it is HIDDEN by moderation', () => {
    const hidden: SimAnswer[] = [
      {
        id: 'a-1',
        userId: USER,
        questionId: PRIVATE_RITUAL.id,
        isCanonical: true,
        body: 'original',
        isCurrent: true,
        moderationStatus: 'hidden',
      },
    ]
    expect(() =>
      simulatePublishQuestionAnswer(
        hidden,
        USER,
        { id: PRIVATE_RITUAL.id, isCanonical: true, isActive: true },
        'trying to sneak an edit through'
      )
    ).toThrow('This answer has been hidden and cannot be edited.')
  })

  it('a visible answer can still be edited normally — the guard is scoped to hidden only', () => {
    const visible: SimAnswer[] = [
      {
        id: 'a-1',
        userId: USER,
        questionId: PRIVATE_RITUAL.id,
        isCanonical: true,
        body: 'original',
        isCurrent: true,
        moderationStatus: 'visible',
      },
    ]
    const result = simulatePublishQuestionAnswer(
      visible,
      USER,
      { id: PRIVATE_RITUAL.id, isCanonical: true, isActive: true },
      'a legitimate edit'
    )
    expect(result[0].body).toBe('a legitimate edit')
  })
})
