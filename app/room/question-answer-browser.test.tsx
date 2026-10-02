// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QuestionAnswerBrowser from './question-answer-browser'
const { load, intersect } = vi.hoisted(() => ({ load: vi.fn(), intersect: { current: null as null | IntersectionObserverCallback } }))
vi.mock('./reading-actions', () => ({ loadRoomAnswers: load }))
vi.mock('./discovery-results', () => ({ default: ({ entries }: { entries: { response: { id: string } }[] }) => <div>{entries.map(e => <p key={e.response.id}>{e.response.id}</p>)}</div> }))
const entries = (start: number, count: number) => Array.from({ length: count }, (_, n) => ({ userId: `u${start+n}`, pseudonym: 'Mia', country: '', genderDisplay: null, ageRange: '', markUrl: null, response: { id: `a${start+n}`, body: 'Answer', prompt: 'Question' } }))
const page = (start: number, count: number, hasMore = true) => ({ entries: entries(start,count), cursor: { createdAt: '2026-10-01T00:00:00Z', answerId: `a${start+count-1}` }, hasMore, error: null })
let host: HTMLDivElement; let root: Root
beforeEach(async () => {
  load.mockReset(); intersect.current=null
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, IntersectionObserver: class { constructor(cb: IntersectionObserverCallback) { intersect.current=cb } observe() {} disconnect() {} } })
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
  await act(async () => root.render(<QuestionAnswerBrowser questionId="question" initial={page(0,3)} filters={{}} returnTo="/room?question=question" />))
})
afterEach(async () => { await act(async () => root.unmount());host.remove();vi.unstubAllGlobals() })
async function visible() { await act(async () => intersect.current?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)) }
describe('question-specific Room pagination', () => {
  it('automatically adds only three, then waits for an explicit click', async () => {
    load.mockResolvedValueOnce(page(3,3)).mockResolvedValueOnce(page(6,6,false))
    await visible();expect(host.querySelectorAll('p')).toHaveLength(6)
    await visible();expect(load).toHaveBeenCalledTimes(1)
    await act(async () => host.querySelector('button')!.click())
    expect(host.querySelectorAll('p')).toHaveLength(12)
    expect(load.mock.calls.map(c=>c[3])).toEqual([3,6])
    expect(load.mock.calls.every(c=>c[0]==='question')).toBe(true)
    expect(host.querySelector('button')).toBeNull()
  })
  it('retains existing answers on failure and supports a manual retry without automatic loops', async () => {
    load.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(page(3,3))
    await visible();expect(host.querySelectorAll('p')).toHaveLength(4)
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    await visible();expect(load).toHaveBeenCalledTimes(1)
    await act(async () => host.querySelector('button')!.click())
    expect(host.querySelectorAll('p')).toHaveLength(6)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
  it('prevents duplicate in-flight requests and duplicate answer cards', async () => {
    let finish!: (value: ReturnType<typeof page>) => void
    load.mockImplementationOnce(() => new Promise(resolve => { finish=resolve }))
    await visible();await visible();expect(load).toHaveBeenCalledTimes(1)
    await act(async () => finish(page(2,3,false)))
    expect(host.querySelectorAll('p')).toHaveLength(5)
  })
})
