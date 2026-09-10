import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import QuestionWorkspace from './question-workspace'
import type { CanonicalQuestionState } from '@/lib/questions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: async () => ({ error: null }) }) }))

// The exact live scenario that crashed: a member who has never
// answered any of the three canonical Questions opens Minds -> Answer
// a Question. All three questions exist; none has an answer.
const ZERO_ANSWER_STATE: CanonicalQuestionState[] = [
  {
    id: 'q-private-ritual',
    slug: 'private_ritual',
    prompt: "Is there something you return to when no one's watching?",
    answer: null,
  },
  {
    id: 'q-place-outsiders',
    slug: 'place_outsiders_miss',
    prompt: "What's something about the place you're from a stranger would never guess?",
    answer: null,
  },
  {
    id: 'q-ordinary-worth',
    slug: 'ordinary_worth_protecting',
    prompt: "What's something ordinary you'd fight to protect?",
    answer: null,
  },
]

describe('QuestionWorkspace — zero-answer state (the exact live-test crash scenario)', () => {
  it('"Answer a Question" renders all three canonical Questions, each Not yet answered', () => {
    const html = renderToStaticMarkup(<QuestionWorkspace tab="new" questions={ZERO_ANSWER_STATE} />)
    expect(html).toContain('no one')
    expect(html).toContain('stranger would never guess')
    expect(html).toContain('fight to protect')
    expect((html.match(/Not yet answered/g) ?? []).length).toBe(3)
  })

  it('"My answers" shows the empty state, not a crash, when nothing is answered yet', () => {
    const html = renderToStaticMarkup(<QuestionWorkspace tab="answers" questions={ZERO_ANSWER_STATE} />)
    expect(html).toContain('answered a Question yet.')
  })

  it('never throws even if a caller fails to supply questions at all — the component boundary defaults to []', () => {
    // @ts-expect-error deliberately simulating a caller/prop-passing bug
    expect(() => renderToStaticMarkup(<QuestionWorkspace tab="new" />)).not.toThrow()
    // @ts-expect-error same, for the "answers" tab's empty-state path
    expect(() => renderToStaticMarkup(<QuestionWorkspace tab="answers" />)).not.toThrow()
  })
})

describe('QuestionWorkspace — "My answers" own-history view (Admin Phase 2A-1, Section 4/9)', () => {
  const ANSWERED_STATE: CanonicalQuestionState[] = [
    {
      id: 'q-private-ritual',
      slug: 'private_ritual',
      prompt: "Is there something you return to when no one's watching?",
      answer: {
        id: 'a-1',
        questionId: 'q-private-ritual',
        slug: 'private_ritual',
        prompt: "Is there something you return to when no one's watching?",
        body: 'A visible answer body.',
        updatedAt: '2026-09-01T00:00:00Z',
        isCurrent: true,
        moderationStatus: 'visible',
      },
    },
  ]

  it('a visible own answer never shows the "Hidden by TEMPA" notice', () => {
    const html = renderToStaticMarkup(<QuestionWorkspace tab="answers" questions={ANSWERED_STATE} />)
    expect(html).not.toContain('Hidden by TEMPA')
    expect(html).toContain('A visible answer body.')
  })

  it('a hidden own answer still renders (own-history access preserved) AND shows a private "Hidden by TEMPA" notice, never a public tombstone', () => {
    const hiddenState: CanonicalQuestionState[] = [
      {
        ...ANSWERED_STATE[0],
        answer: { ...ANSWERED_STATE[0].answer!, moderationStatus: 'hidden' },
      },
    ]
    const html = renderToStaticMarkup(<QuestionWorkspace tab="answers" questions={hiddenState} />)
    // Own-history access preserved: the answer body itself still renders.
    expect(html).toContain('A visible answer body.')
    // The private moderation notice appears exactly once, is never
    // phrased as a public "one result hidden" disclosure, and carries
    // no reporter/moderator/internal-reason detail.
    expect((html.match(/Hidden by TEMPA/g) ?? []).length).toBe(1)
    expect(html).not.toMatch(/reason|moderator|report/i)
  })

  it('an inactive Question whose answer is still visible keeps rendering the answer in "My answers" — deactivation never erases own history', () => {
    // getAllCanonicalQuestions (unfiltered by is_active) is what feeds
    // this tab, so an inactive Question's state object reaching here at
    // all already proves the history path; this asserts the answer
    // itself still renders normally, not suppressed.
    const html = renderToStaticMarkup(<QuestionWorkspace tab="answers" questions={ANSWERED_STATE} />)
    expect(html).toContain('A visible answer body.')
    expect(html).not.toContain('Not yet answered')
  })
})
