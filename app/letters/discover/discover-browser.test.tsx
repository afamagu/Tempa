// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import DiscoverBrowser from './discover-browser'
import { loadMorePeople } from '@/app/room/discovery-actions'
import type { DiscoveryEntry } from '@/app/room/discovery-results'
vi.mock('@/app/room/discovery-actions', () => ({ loadMorePeople: vi.fn() }))
vi.mock('@/app/room/discovery-results', () => ({ default: ({ entries }: { entries: DiscoveryEntry[] }) => <div>{entries.map(p => <article key={p.userId}>{p.pseudonym}</article>)}</div> }))
const person = (n: number) => ({ userId: `u${n}`, pseudonym: `Person ${n}`, country: '', genderDisplay: null, ageRange: '', markUrl: null, response: { id: '', body: '', prompt: '' } })
let intersect: IntersectionObserverCallback
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  vi.stubGlobal('IntersectionObserver', class { constructor(cb: IntersectionObserverCallback) { intersect = cb } observe() {} disconnect() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function mount() {
  await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}><DiscoverBrowser initialValues={{}} initialEntries={[person(1), person(2)]} initialHasMore initialUnavailable={false} suggestions={[person(9)]} seed="visit-1" /></NextIntlClientProvider>))
}
const clickLabel = async (text: string) => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === text)!
  expect(button).toBeTruthy()
  await act(async () => button.click())
}
describe('Discover grid and independent suggestions', () => {
  it('automatically appends a distinct batch without replacing the recommendation rail', async () => {
    vi.mocked(loadMorePeople).mockResolvedValue({ entries: [person(2), person(3)], hasMore: false, error: null })
    await mount()
    await act(async () => intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
    const browse = host.querySelector('[aria-label="Discover people"]')!
    expect(browse.textContent).toContain('Person 1Person 2Person 3')
    expect(loadMorePeople).toHaveBeenCalledWith(expect.objectContaining({ peopleMode: 'browse', browseSeed: 'visit-1' }), ['u1','u2'], true)
    expect(host.querySelector('section[aria-label="Suggested for you"]')!.textContent).toContain('Person 9')
    expect(host.querySelectorAll('section[aria-label="Filters"]')).toHaveLength(1)
  })
  it('keeps one filter area through consecutive filter changes and ignores an old result', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof loadMorePeople>>) => void
    vi.mocked(loadMorePeople).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce({ entries: [person(4)], hasMore: false, error: null })
    await mount()
    await clickLabel('Looking for'); await clickLabel('Cultural exchange')
    await clickLabel('Language'); await clickLabel('Yoruba')
    expect(host.querySelectorAll('section[aria-label="Filters"]')).toHaveLength(1)
    expect(host.querySelectorAll('form')).toHaveLength(1)
    expect(host.querySelector('[aria-label="Discover people"]')!.textContent).toContain('Person 4')
    await act(async () => resolveOld({ entries: [person(5)], hasMore: false, error: null }))
    expect(host.querySelector('[aria-label="Discover people"]')!.textContent).not.toContain('Person 5')
    expect(host.querySelector('section[aria-label="Suggested for you"]')!.textContent).toContain('Person 9')
    expect(loadMorePeople).toHaveBeenLastCalledWith(expect.objectContaining({ intent: 'Cultural exchange', language: 'Yoruba' }), [], true)
  })
  it('stops automatic retries after a failure and offers an explicit retry', async () => {
    vi.mocked(loadMorePeople).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ entries: [person(3)], hasMore: false, error: null })
    await mount()
    await act(async () => intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
    expect(host.querySelector('[role="alert"]')).toBeTruthy()
    await act(async () => intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
    expect(loadMorePeople).toHaveBeenCalledTimes(1)
    await clickLabel('Try again')
    expect(host.querySelector('[aria-label="Discover people"]')!.textContent).toContain('Person 3')
  })
})
