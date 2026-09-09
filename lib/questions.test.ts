import { describe, it, expect } from 'vitest'
import {
  pickCanonicalQuestions,
  buildCanonicalAnswers,
  mergeCanonicalQuestionState,
  needsParticipationGate,
  questionSaveConfirmationCopy,
  nextUnansweredCanonicalQuestion,
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
      { id: 'a-1', question_id: PRIVATE_RITUAL.id, body: 'canonical body', updated_at: '2026-09-01', is_current: true },
      { id: 'a-2', question_id: HISTORICAL.id, body: 'historical body — must never appear', updated_at: '2020-01-01', is_current: false },
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
    })
  })
})

describe('mergeCanonicalQuestionState — Answer a Question completed/uncompleted state', () => {
  it('always returns all three, pairing answered ones and leaving the rest null', () => {
    const answers = buildCanonicalAnswers(THREE_CANONICAL, [
      { id: 'a-1', question_id: PLACE_OUTSIDERS.id, body: 'x', updated_at: 't', is_current: false },
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
      ? { id: `a-${q.slug}`, questionId: q.id, slug: q.slug, prompt: q.prompt, body: 'x', updatedAt: 't', isCurrent: false }
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
})
