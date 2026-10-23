// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const state = vi.hoisted(() => ({
  routes: [] as string[],
  updates: [] as Record<string, unknown>[],
  claimCount: 0,
  candidateCount: 1,
  failLoading: false,
  failPreferenceUpdate: false,
  failCompletionUpdate: false,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (url: string) => state.routes.push(url), refresh: () => {} }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
    from: () => ({
      update: (fields: Record<string, unknown>) => ({
        eq: async () => {
          state.updates.push(fields)
          const error = ('intent' in fields && state.failPreferenceUpdate) || ('auto_match_completed_at' in fields && state.failCompletionUpdate)
            ? { message: 'permission denied' } : null
          return { error }
        },
      }),
    }),
  }),
}))
vi.mock('@/lib/member-introductions', () => ({
  loadFirstArrivalMatches: async () => {
    if (state.failLoading) throw new Error('Network')
    return Array.from({ length: state.candidateCount }, (_, i) => ({
      candidateId: `candidate-${i}`, pseudonym: `Writer ${i}`,
      sharedLanguages: ['English'], sharedIntents: [], answerId: `answer-${i}`,
      languages: ['English'], intents: [], identityLine: 'Canada', markUrl: null, prompt: '', body: 'Hello',
    }))
  },
  sessionIdFromAccessToken: () => 'session-id',
}))
vi.mock('@/lib/introduction-visit', () => ({
  claimIntroductionVisit: () => { state.claimCount++ },
}))
vi.mock('@/app/member-introductions', () => ({
  IntroductionDialog: ({ cards, onClose, onLeave }: {
    cards: unknown[], onClose: () => void, onLeave?: () => Promise<void>
  }) => (
    <div role="dialog" aria-label="Introductions">
      <p>{cards.length} potential pen pals</p>
      <button type="button" onClick={onClose}>Close introductions</button>
      <button type="button" onClick={() => void onLeave?.().then(onClose)}>Write privately</button>
    </div>
  ),
}))

import AutoMatchArrival from './auto-match-arrival'

let node: HTMLDivElement
let root: Root
async function render(initialIntent: string[] = []) {
  node = document.createElement('div')
  document.body.appendChild(node)
  root = createRoot(node)
  await act(async () => { root.render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AutoMatchArrival userId="viewer" initialIntent={initialIntent} />
    </NextIntlClientProvider>
  ) })
}
async function press(label: string) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent?.includes(label))
  expect(button).toBeTruthy()
  await act(async () => { button!.click(); await Promise.resolve(); await Promise.resolve() })
}
const screen = () => document.body.textContent ?? ''

beforeEach(() => {
  state.routes = []
  state.updates = []
  state.claimCount = 0
  state.candidateCount = 1
  state.failLoading = false
  state.failPreferenceUpdate = false
  state.failCompletionUpdate = false
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  node?.remove()
  document.body.innerHTML = ''
})

describe('First arrival Auto-Match interactions', () => {
  it('collects optional reasons, introduces public writers, then offers The Board letter or skip', async () => {
    await render()
    expect(screen()).toContain('What brings you here?')
    await press('Cultural exchange')
    await press('See my introductions')
    expect(state.updates).toContainEqual({ intent: ['Cultural exchange'] })
    expect(state.claimCount).toBe(1)
    expect(document.querySelector('[role=dialog]')).toBeTruthy()
    await press('Close introductions')
    expect(screen()).toContain('Leave a letter someone might recognize.')
    await press('Help me start a letter')
    expect(state.updates.some(u => typeof u.auto_match_completed_at === 'string')).toBe(true)
    expect(state.routes).toEqual(['/board/guided'])
  })

  it('allows members to skip preference questions without erasing stored reasons', async () => {
    await render(['Meaningful friendship', 'Cultural exchange', 'Thoughtful conversation', 'Practising a language'])
    await press('See my introductions')
    expect(state.updates).toEqual([])
    expect(document.querySelector('[role=dialog]')).toBeTruthy()
    await press('Close introductions')
    await press('Explore The Board instead')
    expect(state.routes).toEqual(['/board'])
  })

  it('does not trap a member when fewer than six candidates or a matching outage occurs', async () => {
    state.candidateCount = 0
    await render()
    await press('Skip for now')
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(screen()).toContain('Leave a letter someone might recognize.')
  })

  it('keeps introductions accessible when saving optional preferences fails', async () => {
    state.failPreferenceUpdate = true
    await render()
    await press('Cultural exchange')
    await press('See my introductions')
    expect(document.querySelector('[role=dialog]')).toBeTruthy()
    await press('Close introductions')
    expect(screen()).not.toContain('couldn’t save your preferences')
    await press('Help me start a letter')
    expect(state.routes).toEqual(['/board/guided'])
  })

  it('never traps members even when completion-marker storage fails', async () => {
    state.failCompletionUpdate = true
    await render()
    await press('Skip for now')
    await press('Close introductions')
    await press('Write my own')
    expect(state.routes).toEqual(['/board/write'])
    expect(screen()).not.toContain('couldn’t save your progress')
  })

  it('offers retry and an alternative route if the matching query fails', async () => {
    state.failLoading = true
    await render()
    await press('Skip for now')
    expect(screen()).toContain('Introductions aren’t available right now.')
    await press('Continue to The Board')
    expect(state.routes).toEqual(['/board'])
  })
})
