import { describe, it, expect } from 'vitest'
import { canWriteToMind } from './page'

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
