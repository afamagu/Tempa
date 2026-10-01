// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import PeopleBrowser from './people-browser'
import { loadMorePeople } from './discovery-actions'
import type { DiscoveryEntry } from './discovery-results'
vi.mock('./discovery-actions', () => ({ loadMorePeople: vi.fn() }))
vi.mock('./discovery-results', () => ({ default: ({ entries }: { entries: DiscoveryEntry[] }) => <div>{entries.map((entry) => <p key={entry.userId}>{entry.pseudonym}</p>)}</div> }))
const person = (n: number) => ({ userId: `u${n}`, pseudonym: `Person ${n}`, country: '', genderDisplay: null, ageRange: '', markUrl: null, response: { id: `a${n}`, body: '', prompt: '' } })
describe('Keep looking', () => {
  it('appends new people, retains previous answers and excludes shown identities from the next request', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    vi.mocked(loadMorePeople).mockResolvedValue({ entries: [person(1),person(3)], hasMore: false, error: null })
    await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}><PeopleBrowser initialEntries={[person(1),person(2)]} initialHasMore request={{questionId:'live'}} returnTo="/room"/></NextIntlClientProvider>))
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    expect(loadMorePeople).toHaveBeenCalledWith({ questionId: 'live' }, ['u1','u2'], false)
    expect(host.querySelectorAll('p')).toHaveLength(4) // three identities + end-of-pool status
    expect(host.textContent).toContain('Person 1Person 2Person 3')
    expect(host.querySelector('button')).toBeNull()
    await act(async () => root.unmount()); host.remove()
  })
})
