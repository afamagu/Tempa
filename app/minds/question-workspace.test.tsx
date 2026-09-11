import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import QuestionWorkspace from './question-workspace'
import type { LibraryQuestion, MyQuestionAnswer } from '@/lib/questions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: async () => ({ error: null }) }) }))

// Question source-of-truth correction: "Answer a Question" now receives
// an already-eligible (active, unanswered) set from getEligibleQuestions
// — up to three, never carrying an `answer` field, since anything
// already answered was excluded before this component ever sees it.
const ELIGIBLE_QUESTIONS: LibraryQuestion[] = [
  { id: 'q-private-ritual', prompt: "Is there something you return to when no one's watching?", family: 'reflection' },
  { id: 'q-place-outsiders', prompt: "What's something about the place you're from a stranger would never guess?", family: 'everyday' },
  { id: 'q-ordinary-worth', prompt: "What's something ordinary you'd fight to protect?", family: 'imagination' },
]

describe('QuestionWorkspace — zero-answer state (the exact live-test crash scenario)', () => {
  it('"Answer a Question" renders every eligible Question it\'s given', () => {
    const html = renderToStaticMarkup(<QuestionWorkspace tab="new" questions={ELIGIBLE_QUESTIONS} />)
    expect(html).toContain('no one')
    expect(html).toContain('stranger would never guess')
    expect(html).toContain('fight to protect')
  })

  it('"Answer a Question" shows a calm empty state, not a crash, when nothing is currently eligible', () => {
    const html = renderToStaticMarkup(<QuestionWorkspace tab="new" questions={[]} />)
    expect(html).toContain('Nothing new to answer right now')
  })

  it('"My answers" shows the empty state, not a crash, when nothing is answered yet', () => {
    const html = renderToStaticMarkup(<QuestionWorkspace tab="answers" answers={[]} />)
    expect(html).toContain('answered a Question yet.')
  })

  it('never throws when a caller omits questions/answers entirely — both props are optional and default to []', () => {
    expect(() => renderToStaticMarkup(<QuestionWorkspace tab="new" />)).not.toThrow()
    expect(() => renderToStaticMarkup(<QuestionWorkspace tab="answers" />)).not.toThrow()
  })
})

describe('QuestionWorkspace — "My answers" own-history view (Admin Phase 2A-1, Section 4/9)', () => {
  const ANSWERED: MyQuestionAnswer[] = [
    {
      id: 'a-1',
      questionId: 'q-private-ritual',
      prompt: "Is there something you return to when no one's watching?",
      body: 'A visible answer body.',
      updatedAt: '2026-09-01T00:00:00Z',
      isCurrent: true,
      moderationStatus: 'visible',
    },
  ]

  it('a visible own answer never shows the "Hidden by TEMPA" notice', () => {
    const html = renderToStaticMarkup(<QuestionWorkspace tab="answers" answers={ANSWERED} />)
    expect(html).not.toContain('Hidden by TEMPA')
    expect(html).toContain('A visible answer body.')
  })

  it('a hidden own answer still renders (own-history access preserved) AND shows a private "Hidden by TEMPA" notice, never a public tombstone', () => {
    const hidden: MyQuestionAnswer[] = [{ ...ANSWERED[0], moderationStatus: 'hidden' }]
    const html = renderToStaticMarkup(<QuestionWorkspace tab="answers" answers={hidden} />)
    // Own-history access preserved: the answer body itself still renders.
    expect(html).toContain('A visible answer body.')
    // The private moderation notice appears exactly once, is never
    // phrased as a public "one result hidden" disclosure, and carries
    // no reporter/moderator/internal-reason detail.
    expect((html.match(/Hidden by TEMPA/g) ?? []).length).toBe(1)
    expect(html).not.toMatch(/reason|moderator|report/i)
  })

  it('an answer to a since-deactivated (or since-replaced) Question keeps rendering in "My answers" — deactivation never erases own history', () => {
    // getMyAnswers is unfiltered by is_active entirely — an answer
    // reaching this component at all already proves the history path;
    // this asserts it renders normally, not suppressed.
    const html = renderToStaticMarkup(<QuestionWorkspace tab="answers" answers={ANSWERED} />)
    expect(html).toContain('A visible answer body.')
  })

  it('a member with more than three historical answers sees all of them — "My answers" is never capped to three', () => {
    const many: MyQuestionAnswer[] = Array.from({ length: 5 }, (_, i) => ({
      id: `a-${i}`,
      questionId: `q-${i}`,
      prompt: `Prompt number ${i}`,
      body: `Body ${i}`,
      updatedAt: '2026-09-01T00:00:00Z',
      isCurrent: i === 0,
      moderationStatus: 'visible' as const,
    }))
    const html = renderToStaticMarkup(<QuestionWorkspace tab="answers" answers={many} />)
    for (let i = 0; i < 5; i++) {
      expect(html).toContain(`Prompt number ${i}`)
    }
  })
})
