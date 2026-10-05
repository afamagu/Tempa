// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QuestionAnswerBrowser from './question-answer-browser'

const { load } = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('./reading-actions', () => ({ loadRoomAnswers: load }))
vi.mock('./discovery-results', () => ({
  default: ({ entries }: { entries: { response: { id: string } }[] }) => (
    <div>{entries.map((entry) => <p key={entry.response.id}>{entry.response.id}</p>)}</div>
  ),
}))

const entries = (start: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    userId: `00000000-0000-0000-0000-${String(start + index + 1).padStart(12, '0')}`,
    pseudonym: 'Mia',
    country: '',
    genderDisplay: null,
    ageRange: '',
    markUrl: null,
    response: {
      id: `a${start + index}`,
      body: 'Answer',
      prompt: 'Question',
    },
  }))

const page = (start: number, count: number, hasMore = true) => {
  const resultEntries = entries(start, count)
  return {
    entries: resultEntries,
    shownUserIds: resultEntries.map((entry) => entry.userId),
    hasMore,
    error: null,
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  load.mockReset()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <QuestionAnswerBrowser
        questionId="00000000-0000-0000-0000-000000000999"
        initial={page(0, 6)}
        filters={{}}
        returnTo="/room?question=00000000-0000-0000-0000-000000000999"
      />
    )
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('question-specific Room pagination', () => {
  it('starts with six and loads the next six only after Keep looking', async () => {
    load.mockResolvedValueOnce(page(6, 6, false))

    expect(host.querySelectorAll('p')).toHaveLength(6)
    expect(load).not.toHaveBeenCalled()

    await act(async () => host.querySelector('button')!.click())

    expect(host.querySelectorAll('p')).toHaveLength(12)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load.mock.calls[0][3]).toBe(6)
    expect(host.querySelector('button')).toBeNull()
  })

  it('passes every previously shown identity so later batches cannot repeat people', async () => {
    load.mockResolvedValueOnce(page(6, 2, false))

    await act(async () => host.querySelector('button')!.click())

    expect(load.mock.calls[0][1]).toEqual(page(0, 6).shownUserIds)
  })

  it('retains existing answers on failure and supports an explicit retry', async () => {
    load.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(page(6, 2, false))

    await act(async () => host.querySelector('button')!.click())
    expect(host.querySelectorAll('p')).toHaveLength(7)
    expect(host.querySelector('[role="alert"]')).not.toBeNull()

    await act(async () => host.querySelector('button')!.click())
    expect(host.querySelectorAll('p')).toHaveLength(8)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})
