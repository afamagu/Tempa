// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import DiscoverBrowser from './discover-browser'
import { loadMorePeople } from '@/app/room/discovery-actions'
import { loadPassiveIntroductions } from './actions'
import { markIntroductionPresented } from '@/app/introduction-actions'
import type { DiscoveryEntry } from '@/app/room/discovery-results'

vi.mock('@/app/room/discovery-actions', () => ({ loadMorePeople: vi.fn() }))
vi.mock('./actions', () => ({ loadPassiveIntroductions: vi.fn() }))
vi.mock('@/app/introduction-actions', () => ({ markIntroductionPresented: vi.fn() }))
vi.mock('@/app/room/discovery-results', () => ({
  default: ({ entries }: { entries: DiscoveryEntry[] }) => (
    <div>{entries.map((person) => <article key={person.userId}>{person.pseudonym}</article>)}</div>
  ),
}))

const person = (n: number): DiscoveryEntry => ({
  userId: `u${n}`,
  pseudonym: `Person ${n}`,
  country: '',
  genderDisplay: null,
  ageRange: '',
  markUrl: null,
  response: { id: `a${n}`, body: '', prompt: '' },
})

let intersect: IntersectionObserverCallback
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  sessionStorage.clear()
  vi.mocked(loadPassiveIntroductions).mockResolvedValue({ entries: [], error: null })
  vi.mocked(markIntroductionPresented).mockResolvedValue(undefined)
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: IntersectionObserverCallback) { intersect = cb }
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function mount(values: Record<string, string> = { intent: 'Pen pals' }) {
  await act(async () => root.render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DiscoverBrowser
        initialValues={values}
        initialEntries={[person(1), person(2)]}
        initialHasMore
        initialUnavailable={false}
        seed="visit-1"
      />
    </NextIntlClientProvider>
  ))
}

const clickLabel = async (text: string) => {
  const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === text)!
  expect(button).toBeTruthy()
  await act(async () => button.click())
}

describe('finite passive Discover and intentional broad discovery', () => {
  it('automatically appends a distinct batch only for intentional discovery', async () => {
    vi.mocked(loadMorePeople).mockResolvedValue({ entries: [person(2), person(3)], hasMore: false, error: null })
    await mount()
    await act(async () => intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
    const browse = host.querySelector('[aria-label="Discover people"]')!
    expect(browse.textContent).toContain('Person 1Person 2Person 3')
    expect(loadMorePeople).toHaveBeenCalledWith(
      expect.objectContaining({ peopleMode: 'browse', browseSeed: 'visit-1', intent: 'Pen pals' }),
      ['u1', 'u2'],
      true
    )
    expect(host.querySelectorAll('section[aria-label="Filters"]')).toHaveLength(1)
  })

  it('automatically loads only one broad batch, then requires the explicit button', async () => {
    vi.mocked(loadMorePeople)
      .mockResolvedValueOnce({ entries: [person(3)], hasMore: true, error: null })
      .mockResolvedValueOnce({ entries: [person(4)], hasMore: true, error: null })
    await mount()
    await act(async () => intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
    await act(async () => intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
    expect(loadMorePeople).toHaveBeenCalledTimes(1)
    await clickLabel('See more people')
    expect(loadMorePeople).toHaveBeenCalledTimes(2)
    await act(async () => intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
    expect(loadMorePeople).toHaveBeenCalledTimes(2)
  })

  it('restores an intentional Discover return after a profile detour without auto-loading again', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    sessionStorage.setItem('tempa.discover.return:viewer', JSON.stringify({
      at: Date.now(),
      url: '/letters/discover?intent=Pen+pals',
      entries: [person(1), person(2), person(3)],
      hasMore: true,
      seed: 'original-visit',
      automaticUsed: true,
      presentedIds: [],
      scrollY: 450,
    }))
    await act(async () => root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <DiscoverBrowser
          initialValues={{ intent: 'Pen pals' }}
          initialEntries={[person(1)]}
          initialHasMore
          initialUnavailable={false}
          seed="new-visit"
          viewerId="viewer"
          restore
        />
      </NextIntlClientProvider>
    ))
    expect(host.querySelector('[aria-label="Discover people"]')!.textContent).toContain('Person 3')
    expect(window.scrollTo).toHaveBeenCalledWith(0, 450)
    expect(loadMorePeople).not.toHaveBeenCalled()
    vi.mocked(loadMorePeople).mockResolvedValueOnce({ entries: [person(4)], hasMore: false, error: null })
    await clickLabel('See more people')
    expect(loadMorePeople).toHaveBeenCalledWith(
      expect.objectContaining({ browseSeed: 'original-visit', afterUserId: 'u3' }),
      ['u1', 'u2', 'u3'],
      true
    )
  })

  it('keeps one filter area through consecutive filter changes and ignores an old result', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof loadMorePeople>>) => void
    vi.mocked(loadMorePeople)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce({ entries: [person(4)], hasMore: false, error: null })
    await mount()
    await clickLabel('Looking for')
    await clickLabel('Cultural exchange')
    await clickLabel('Language')
    await clickLabel('Yoruba')
    expect(host.querySelectorAll('section[aria-label="Filters"]')).toHaveLength(1)
    expect(host.querySelectorAll('form')).toHaveLength(1)
    expect(host.querySelector('[aria-label="Discover people"]')!.textContent).toContain('Person 4')
    await act(async () => resolveOld({ entries: [person(5)], hasMore: false, error: null }))
    expect(host.querySelector('[aria-label="Discover people"]')!.textContent).not.toContain('Person 5')
    expect(loadMorePeople).toHaveBeenLastCalledWith(
      expect.objectContaining({ intent: 'Cultural exchange', language: 'Yoruba' }),
      [],
      true
    )
  })

  it('stops automatic broad retries after a failure and offers an explicit retry', async () => {
    vi.mocked(loadMorePeople)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ entries: [person(3)], hasMore: false, error: null })
    await mount()
    await act(async () => intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
    expect(host.querySelector('[role="alert"]')).toBeTruthy()
    await act(async () => intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
    expect(loadMorePeople).toHaveBeenCalledTimes(1)
    await clickLabel('Try again')
    expect(host.querySelector('[aria-label="Discover people"]')!.textContent).toContain('Person 3')
  })

  it('never turns blank passive Discover into broad paging', async () => {
    await mount({})
    await act(async () => intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
    expect(loadMorePeople).not.toHaveBeenCalled()
    expect(host.textContent).toContain('That’s everyone we’d like to introduce today.')
  })
})
