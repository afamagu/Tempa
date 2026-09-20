import { describe, it, expect } from 'vitest'
import { canWriteToMind, chooseProfileAnswer } from './page'
import type { MyQuestionAnswer } from '@/lib/questions'

function state(overrides: Partial<Parameters<typeof canWriteToMind>[0]> = {}) {
  return {
    isSelf: false,
    alreadyCorresponding: false,
    hasCurrentAnswer: true,
    currentAnswerAlreadyContacted: false,
    ...overrides,
  }
}

describe('canWriteToMind', () => {
  it('self-profile: never offered, regardless of anything else', () => {
    expect(canWriteToMind(state({ isSelf: true }))).toBe(false)
  })

  it('non-self profile with a fresh current answer: offered', () => {
    expect(canWriteToMind(state())).toBe(true)
  })

  it('already corresponding: not offered — "Open your correspondence" takes over instead', () => {
    expect(canWriteToMind(state({ alreadyCorresponding: true }))).toBe(false)
  })

  it('no current answer to write against: not offered', () => {
    expect(canWriteToMind(state({ hasCurrentAnswer: false }))).toBe(false)
  })

  it('already contacted this exact current answer: not offered again', () => {
    expect(canWriteToMind(state({ currentAnswerAlreadyContacted: true }))).toBe(false)
  })
})

function profileAnswer(overrides: Partial<MyQuestionAnswer> = {}): MyQuestionAnswer {
  return {
    id: 'answer-1',
    questionId: 'question-1',
    prompt: 'A prompt',
    body: 'A response',
    updatedAt: '2026-09-01T00:00:00Z',
    isCurrent: false,
    isPrimary: false,
    moderationStatus: 'visible',
    ...overrides,
  }
}

describe('chooseProfileAnswer — public-profile continuity', () => {
  it('prefers the Flagship response', () => {
    const current = profileAnswer({ id: 'current', isCurrent: true })
    const flagship = profileAnswer({ id: 'flagship', isPrimary: true })
    expect(chooseProfileAnswer([current, flagship])?.id).toBe('flagship')
  })

  it('keeps an established member\'s historical current response prominent without a Flagship answer', () => {
    const current = profileAnswer({ id: 'legacy-current', isCurrent: true })
    expect(chooseProfileAnswer([current])?.id).toBe('legacy-current')
  })

  it('uses the latest response when historical data has no primary/current flag', () => {
    const older = profileAnswer({ id: 'older', updatedAt: '2026-08-01T00:00:00Z' })
    const newer = profileAnswer({ id: 'newer', updatedAt: '2026-09-01T00:00:00Z' })
    expect(chooseProfileAnswer([older, newer])?.id).toBe('newer')
  })
})
