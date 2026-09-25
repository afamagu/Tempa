import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MAX_INTRODUCTIONS,
  consumeIntroduction,
  isForwardSwipe,
  isVisitHandled,
  loadMemberIntroductions,
  markVisitHandled,
  sessionIdFromAccessToken,
  toIntroductionCards,
} from './member-introductions'

function row(n: number, extra: Record<string, unknown> = {}) {
  return {
    candidate_id: `c${n}`,
    pseudonym: `P${n}`,
    country: 'Nigeria',
    gender: 'Self-describe',
    gender_custom: 'Agender',
    age_range: '25-34',
    mark_id: n % 2 ? `m${n}` : null,
    languages: ['English', 'Yoruba'],
    intent: ['Cultural exchange'],
    shared_languages: ['English'],
    shared_intents: [],
    answer_id: `a${n}`,
    prompt: 'What are you carrying?',
    body: 'A long response…',
    ...extra,
  }
}

function fakeRpc(result: unknown, calls: { fn: string; args: unknown }[] = []) {
  return {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args })
      if (result instanceof Error) throw result
      return result
    },
    storage: { from: () => ({ getPublicUrl: (name: string) => ({ data: { publicUrl: `https://cdn/${name}` } }) }) },
    from: () => {
      throw new Error('introductions must never read tables directly')
    },
  } as unknown as SupabaseClient
}

const jwt = (payload: object) => `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`

describe('toIntroductionCards', () => {
  it('maps public card fields, the People identity line and the Mark URL', () => {
    const [card] = toIntroductionCards([row(1)], (m) => `url:${m}`)
    expect(card).toMatchObject({
      candidateId: 'c1',
      identityLine: 'Nigeria · Agender · 25-34',
      markUrl: 'url:m1',
      sharedLanguages: ['English'],
      sharedIntents: [],
      answerId: 'a1',
    })
  })

  it('never exceeds seven and never repeats a person', () => {
    const rows = [row(1), row(1), ...Array.from({ length: 12 }, (_, i) => row(i + 2))]
    const cards = toIntroductionCards(rows, (m) => m)
    expect(cards).toHaveLength(MAX_INTRODUCTIONS)
    expect(new Set(cards.map((c) => c.candidateId)).size).toBe(MAX_INTRODUCTIONS)
  })
})

describe('loadMemberIntroductions — one bounded RPC, fails open', () => {
  it('calls get_member_introductions once with the 7 cap', async () => {
    const calls: { fn: string; args: unknown }[] = []
    const cards = await loadMemberIntroductions(fakeRpc({ data: [row(1)], error: null }, calls))
    expect(calls).toEqual([{ fn: 'get_member_introductions', args: { p_limit: 7 } }])
    expect(cards[0].markUrl).toBe('https://cdn/m1.png')
  })

  it('CASE 9 — no candidates → empty (nothing to show)', async () => {
    expect(await loadMemberIntroductions(fakeRpc({ data: [], error: null }))).toEqual([])
  })

  it('CASE 10 — RPC error or network throw → empty, never throws', async () => {
    expect(await loadMemberIntroductions(fakeRpc({ data: null, error: { message: 'boom' } }))).toEqual([])
    expect(await loadMemberIntroductions(fakeRpc(new Error('offline')))).toEqual([])
  })
})

describe('consumeIntroduction', () => {
  it('sends only the candidate and reason (viewer is always auth.uid() server-side)', async () => {
    const calls: { fn: string; args: unknown }[] = []
    await consumeIntroduction(fakeRpc({ data: null, error: null }, calls), 'c1', 'write')
    expect(calls).toEqual([{ fn: 'consume_member_introduction', args: { p_candidate_id: 'c1', p_reason: 'write' } }])
  })

  it('never blocks navigation longer than its timeout', async () => {
    const hanging = { rpc: () => new Promise(() => {}) } as unknown as SupabaseClient
    const start = Date.now()
    await consumeIntroduction(hanging, 'c1', 'profile', 30)
    expect(Date.now() - start).toBeLessThan(1000)
  })
})

describe('once-per-visit key', () => {
  it('uses the auth session_id, so a new sign-in is a new visit', () => {
    expect(sessionIdFromAccessToken(jwt({ session_id: 's-1', sub: 'u' }))).toBe('s-1')
    expect(sessionIdFromAccessToken(jwt({ sub: 'u' }))).toBe('u')
    expect(sessionIdFromAccessToken(null)).toBeNull()
    expect(sessionIdFromAccessToken('garbage')).toBeNull()
  })

  it('handled flag is per session id', () => {
    const map = new Map<string, string>()
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
    expect(isVisitHandled(storage, 's-1')).toBe(false)
    markVisitHandled(storage, 's-1')
    expect(isVisitHandled(storage, 's-1')).toBe(true)
    expect(isVisitHandled(storage, 's-2')).toBe(false)
  })

  it('throwing storage is treated as handled (never re-shows on every navigation)', () => {
    const storage = { getItem: () => { throw new Error('denied') } }
    expect(isVisitHandled(storage, 's-1')).toBe(true)
  })
})

describe('isForwardSwipe — deliberate LEFT swipe only', () => {
  it('advances on a clear left swipe', () => expect(isForwardSwipe(-80, 10)).toBe(true))
  it('never on a right swipe (no going back)', () => expect(isForwardSwipe(120, 0)).toBe(false))
  it('ignores tiny movement', () => expect(isForwardSwipe(-30, 0)).toBe(false))
  it('vertical scrolling wins when the gesture is mostly vertical', () => expect(isForwardSwipe(-70, 90)).toBe(false))
})
