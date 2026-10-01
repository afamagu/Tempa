// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { stopIntroductionPresence } from '@/lib/introduction-visit'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import path from 'node:path'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => state.pathname }))

type Call = { fn: string; args: Record<string, unknown> }
const state = {
  calls: [] as Call[],
  rows: [] as unknown[],
  fail: false,
  pathname: '/home',
  sessionPayload: { session_id: 'visit-1' } as Record<string, string>,
}
const token = () => `h.${btoa(JSON.stringify(state.sessionPayload))}.s`
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: token() } } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args })
      if (fn === 'get_member_introductions') {
        if (state.fail) throw new Error('network down')
        return { data: state.rows, error: null }
      }
      return { data: null, error: null }
    },
    storage: { from: () => ({ getPublicUrl: (n: string) => ({ data: { publicUrl: `https://cdn/${n}` } }) }) },
  }),
}))

const { default: MemberIntroductions } = await import('./member-introductions')

const row = (id: string) => ({
  candidate_id: id, pseudonym: `Name ${id}`, country: 'Kenya', gender: 'Woman', gender_custom: null, age_range: '25-34',
  mark_id: null, languages: ['English'], intent: ['Cultural exchange'], shared_languages: ['English'], shared_intents: [],
  priority_tier: 0, answer_id: `ans-${id}`, prompt: 'A question', body: 'Line one\n'.repeat(80),
})

let container: HTMLDivElement
let root: Root

async function mount(enabled = true) {
  container = document.createElement('div')
  container.id = 'app'
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en}><MemberIntroductions enabled={enabled} /></NextIntlClientProvider>))
  // idle callback fallback (setTimeout 300) + async RPCs
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  await act(async () => { await vi.runOnlyPendingTimersAsync() })
}
async function unmount() {
  await act(async () => root.unmount())
  container.remove()
}
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null
const current = () => dialog()?.querySelector('h2')?.textContent
const button = (label: string | RegExp) =>
  Array.from(document.querySelectorAll('button')).find((b) =>
    typeof label === 'string' ? b.getAttribute('aria-label') === label || b.textContent === label : label.test(b.getAttribute('aria-label') ?? b.textContent ?? '')
  ) as HTMLButtonElement | undefined
const called = (fn: string) => state.calls.filter((c) => c.fn === fn).map((c) => c.args)
async function click(b: HTMLElement | undefined) {
  expect(b).toBeTruthy()
  await act(async () => { b!.click(); await vi.advanceTimersByTimeAsync(0) })
}
async function key(k: string) {
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k })) })
}
async function swipe(dx: number, dy = 0) {
  const el = dialog()!
  const touch = (x: number, y: number) => ({ clientX: x, clientY: y, identifier: 0, target: el })
  await act(async () => {
    el.dispatchEvent(Object.assign(new Event('touchstart', { bubbles: true }), { touches: [touch(200, 200)], changedTouches: [touch(200, 200)] }))
    el.dispatchEvent(Object.assign(new Event('touchend', { bubbles: true }), { touches: [], changedTouches: [touch(200 + dx, 200 + dy)] }))
  })
}

beforeEach(() => {
  stopIntroductionPresence()
  vi.useFakeTimers()
  localStorage.clear()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  push.mockReset()
  state.calls = []
  state.rows = ['A', 'B', 'C'].map(row)
  state.fail = false
  state.pathname = '/home'
  state.sessionPayload = { session_id: 'visit-1' }
})
afterEach(async () => {
  await unmount()
  stopIntroductionPresence()
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

describe('Member introductions — appearance', () => {
  it('opens a floating dialog over the page (page stays in the DOM, made inert)', async () => {
    await mount()
    expect(dialog()).toBeTruthy()
    expect(dialog()!.getAttribute('aria-modal')).toBe('true')
    expect(current()).toBe('Name A')
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(true)
    expect(document.body.textContent).toContain('People to meet · 1 of 3')
  })

  it('CASE 9 — no candidates: no dialog, no empty modal', async () => {
    state.rows = []
    await mount()
    expect(dialog()).toBeNull()
  })

  it('CASE 10 — RPC failure fails open: no dialog, page untouched', async () => {
    state.fail = true
    await mount()
    expect(dialog()).toBeNull()
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(false)
  })
})

describe('Member introductions — presented vs consumed', () => {
  it('fetching presents nothing; only the active card is presented', async () => {
    await mount()
    expect(called('mark_member_introduction_presented')).toEqual([{ p_candidate_id: 'A' }])
    expect(called('consume_member_introduction')).toEqual([])
  })

  it('CASE 4 — × closes instantly: A presented, not consumed; B/C untouched', async () => {
    await mount()
    await click(button('Close introductions'))
    expect(dialog()).toBeNull()
    expect(called('mark_member_introduction_presented')).toEqual([{ p_candidate_id: 'A' }])
    expect(called('consume_member_introduction')).toEqual([])
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(false)
  })

  it('CASE 5 — Next consumes A (advanced) and presents B; there is no way back', async () => {
    await mount()
    await click(button('Next person'))
    expect(called('consume_member_introduction')).toEqual([{ p_candidate_id: 'A', p_reason: 'advanced' }])
    expect(called('mark_member_introduction_presented')).toEqual([{ p_candidate_id: 'A' }, { p_candidate_id: 'B' }])
    expect(current()).toBe('Name B')
    expect(button(/previous|back/i)).toBeUndefined()
    await key('ArrowLeft')
    await swipe(150)
    expect(current()).toBe('Name B')
  })

  it('left swipe advances; mostly-vertical movement does not', async () => {
    await mount()
    await swipe(-40, 200)
    expect(current()).toBe('Name A')
    await swipe(-120, 10)
    expect(current()).toBe('Name B')
  })

  it('ArrowRight advances, Escape closes', async () => {
    await mount()
    await key('ArrowRight')
    expect(current()).toBe('Name B')
    await key('Escape')
    expect(dialog()).toBeNull()
  })

  it('advancing the last card consumes it and closes cleanly', async () => {
    state.rows = [row('A')]
    await mount()
    expect(button('Finish introductions')).toBeTruthy()
    await click(button('Finish introductions'))
    expect(called('consume_member_introduction')).toEqual([{ p_candidate_id: 'A', p_reason: 'advanced' }])
    expect(dialog()).toBeNull()
  })

  it('CASE 6 — Write consumes (write) BEFORE navigating to compose', async () => {
    await mount()
    await click(button('Write to Name A'))
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(called('consume_member_introduction')).toEqual([{ p_candidate_id: 'A', p_reason: 'write' }])
    expect(push).toHaveBeenCalledWith('/write/A?a=ans-A&source=member_introduction&returnTo=%2Fhome')
    const consumeOrder = state.calls.findIndex((c) => c.fn === 'consume_member_introduction')
    expect(consumeOrder).toBeGreaterThan(-1)
  })

  it('CASE 6 — View profile consumes (profile) before navigating', async () => {
    await mount()
    await click(button(/View Name A.s profile/))
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(called('consume_member_introduction')).toEqual([{ p_candidate_id: 'A', p_reason: 'profile' }])
    // Canonical profile preserves Home as the deterministic return destination.
    expect(push).toHaveBeenCalledWith('/room/A?returnTo=%2Fhome')
    expect(dialog()).toBeNull()
  })
})

describe('Member introductions — once per visit (CASE 8)', () => {
  it('a remount (navigation) or refresh in the same visit does not fetch or reopen', async () => {
    await mount()
    await click(button('Close introductions'))
    await unmount()
    const before = called('get_member_introductions').length
    await mount()
    expect(dialog()).toBeNull()
    expect(called('get_member_introductions').length).toBe(before)
  })

  it('a new auth session (sign-out → sign-in) is a new visit', async () => {
    await mount()
    await click(button('Close introductions'))
    await unmount()
    state.sessionPayload = { session_id: 'visit-2' }
    await mount()
    expect(dialog()).toBeTruthy()
  })
})

describe('Member introductions — presentation contract', () => {
  const source = readFileSync(path.join(__dirname, 'member-introductions.tsx'), 'utf8')
  it('floats with margin on every viewport (never full-screen) over a translucent backdrop', () => {
    expect(source).toContain('fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-8')
    expect(source).toContain('max-h-[82dvh] w-full max-w-xl')
    expect(source).toContain('rounded-xl')
    expect(source).toContain('bg-foreground/35')
  })
  it('scrolls inside the card body and respects reduced motion', () => {
    expect(source).toContain('overflow-y-auto overscroll-contain')
    expect(source).toContain('motion-safe:animate-[tempa-intro-in_200ms_ease-out]')
  })
  it('no like/dislike/match-percentage mechanics', () => {
    expect(source).not.toMatch(/\blike\b|dislike|heart|% match|percent/i)
  })
  it('is mounted once in AppShell (not in onboarding, admin or compose)', () => {
    const shell = readFileSync(path.join(__dirname, 'app-shell.tsx'), 'utf8')
    expect(shell).toContain("<MemberIntroductions enabled={activeNav === 'home'} />")
  })
})


describe('Member introductions — long-return and navigation gates', () => {
  it('a short absence does not fetch again', async () => {
    await mount(); await click(button('Close introductions'))
    const before = called('get_member_introductions').length
    await act(async () => window.dispatchEvent(new Event('blur')))
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000) })
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(called('get_member_introductions')).toHaveLength(before)
    expect(dialog()).toBeNull()
  })
  it('after twenty minutes away, only never-presented newcomers return', async () => {
    await mount(); await click(button('Close introductions'))
    state.rows = [ { ...row('A'), priority_tier: 2 }, { ...row('B'), priority_tier: 1 }, row('NEW') ]
    await act(async () => window.dispatchEvent(new Event('blur')))
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60 * 1000) })
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(current()).toBe('Name NEW')
    expect(document.body.textContent).toContain('People to meet · 1 of 1')
  })
  it('a long return without unseen newcomers produces no overlay', async () => {
    await mount(); await click(button('Close introductions'))
    state.rows = [{ ...row('A'), priority_tier: 2 }]
    await act(async () => window.dispatchEvent(new Event('blur')))
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60 * 1000) })
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(dialog()).toBeNull()
  })
  it('active use of another menu does not count as an absence', async () => {
    await mount(); await click(button('Close introductions')); await unmount()
    state.pathname = '/letters'; await mount(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(25 * 60 * 1000) })
    await unmount(); state.pathname = '/home'; await mount()
    expect(dialog()).toBeNull()
    expect(called('get_member_introductions')).toHaveLength(1)
  })
  it('an active focused composer does not count as an absence', async () => {
    await mount(); await click(button('Close introductions')); await unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(25 * 60 * 1000) })
    await mount()
    expect(dialog()).toBeNull()
    expect(called('get_member_introductions')).toHaveLength(1)
  })
  it('a profile with Home active in its nav never opens the overlay', async () => {
    state.pathname = '/room/A'; await mount()
    expect(dialog()).toBeNull()
    expect(called('get_member_introductions')).toHaveLength(0)
  })
  it('the name opens the canonical profile with its Home return path', async () => {
    await mount()
    const name = [...dialog()!.querySelectorAll('button')].find(b => b.textContent === 'Name A')!
    await click(name)
    expect(push).toHaveBeenCalledWith('/room/A?returnTo=%2Fhome')
  })
  it('focus wraps within the introduction and Escape restores the background', async () => {
    await mount()
    const buttons = [...dialog()!.querySelectorAll('button')]
    buttons.at(-1)!.focus(); await key('Tab')
    expect(document.activeElement).toBe(buttons[0])
    await key('Escape')
    expect(document.getElementById('app')!.hasAttribute('inert')).toBe(false)
  })
})

describe('Member introductions — identity and focus', () => {
  it('the Mark opens the same profile as the name', async () => {
    await mount()
    const markButton = dialog()!.querySelector<HTMLButtonElement>('button[aria-label="View Name A’s profile"]')!
    await click(markButton)
    expect(push).toHaveBeenCalledWith('/room/A?returnTo=%2Fhome')
  })
  it('closing restores the original focused control', async () => {
    const original = document.createElement('button'); document.body.append(original); original.focus()
    await mount(); await click(button('Close introductions'))
    expect(document.activeElement).toBe(original)
    original.remove()
  })
})
