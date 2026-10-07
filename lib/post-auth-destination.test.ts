import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolvePostAuthDestination } from './post-auth-destination'
import { CURRENT_TERMS_VERSION, CURRENT_COMMUNITY_GUIDELINES_VERSION } from './legal'

// Cross-browser magic-link fix (2026-09-24) — the ONE shared account-
// entry resolver both app/auth/callback/route.ts (Google/OAuth) and
// app/auth/confirm/verify-magic-link-action.ts (email magic link) call,
// so a direct unit test here is what actually proves there is only ever
// one definition of "where an authenticated member belongs" — the two
// callers' own tests (route.test.ts / verify-magic-link-action.test.ts)
// already exercise it indirectly, but this is the one place its own
// logic is tested in isolation.

function fakeSupabase(options: {
  profile?: { id: string; onboarding_stage: string } | null
  eligibility?: { status: string } | null
  languageConfirmed?: boolean
  languageError?: boolean
  legalRows?: { document_type: string; document_version: string }[]
  pilotAccess?: boolean
  pilotError?: boolean
}) {
  const from = vi.fn((table: string) => {
    if (table === 'member_language_preferences') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: options.languageConfirmed === false ? null : { language_confirmed_at: '2026-09-30T00:00:00Z' },
        error: options.languageError ? { message: 'migration missing' } : null,
      }) }) }) }
    }
    if (table === 'profiles') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: options.profile ?? null }) }) }) }
    }
    if (table === 'account_eligibility') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: options.eligibility ?? null }) }) }) }
    }
    if (table === 'legal_acceptances') {
      return { select: () => ({ eq: () => ({ data: options.legalRows ?? [] } as never) }) }
    }
    throw new Error(`unexpected table: ${table}`)
  })
  const rpc = vi.fn(async (name: string) => {
    if (name !== 'current_pilot_access') throw new Error(`unexpected rpc: ${name}`)
    return {
      data: options.pilotAccess ?? true,
      error: options.pilotError ? { message: 'migration missing' } : null,
    }
  })
  return { from, rpc } as unknown as SupabaseClient
}

const CURRENT_LEGAL_ROWS = [
  { document_type: 'terms_of_service', document_version: CURRENT_TERMS_VERSION },
  { document_type: 'community_guidelines', document_version: CURRENT_COMMUNITY_GUIDELINES_VERSION },
]

describe('resolvePostAuthDestination', () => {
  it('sends an authenticated account outside the controlled pilot directly to /pilot-access', async () => {
    const supabase = fakeSupabase({
      pilotAccess: false,
      profile: null,
      eligibility: null,
      legalRows: [],
    })

    expect(await resolvePostAuthDestination(supabase, 'uninvited', '/home')).toBe('/pilot-access')
  })

  it('fails open only when the pilot RPC itself is unavailable during deploy ordering', async () => {
    const supabase = fakeSupabase({
      pilotError: true,
      profile: null,
      eligibility: null,
      legalRows: [],
    })

    expect(await resolvePostAuthDestination(supabase, 'deploy-race', '/home')).toBe('/begin?next=%2Fhome')
  })

  it('an existing, eligible, legally-current member is sent to the requested destination', async () => {
    const supabase = fakeSupabase({
      profile: { id: 'u1', onboarding_stage: 'complete' },
      eligibility: { status: 'eligible' },
      legalRows: CURRENT_LEGAL_ROWS,
    })

    const destination = await resolvePostAuthDestination(supabase, 'u1', '/letters')
    expect(destination).toBe('/letters')
  })

  it('defaults to /home when no specific destination was requested', async () => {
    const supabase = fakeSupabase({
      profile: { id: 'u1', onboarding_stage: 'complete' },
      eligibility: { status: 'eligible' },
      legalRows: CURRENT_LEGAL_ROWS,
    })

    const destination = await resolvePostAuthDestination(supabase, 'u1', '/home')
    expect(destination).toBe('/home')
  })

  it('a brand-new account with no eligibility row yet is sent to /begin, with the requested destination preserved as `next`', async () => {
    const supabase = fakeSupabase({ profile: null, eligibility: null, legalRows: [] })

    const destination = await resolvePostAuthDestination(supabase, 'new-user', '/letters')
    expect(destination).toBe('/begin?next=%2Fletters')
  })

  it('an ineligible account is sent to /begin regardless of profile completeness', async () => {
    const supabase = fakeSupabase({
      profile: { id: 'u1', onboarding_stage: 'complete' },
      eligibility: { status: 'ineligible' },
      legalRows: CURRENT_LEGAL_ROWS,
    })

    const destination = await resolvePostAuthDestination(supabase, 'u1', '/home')
    expect(destination).toBe('/begin?next=%2Fhome')
  })

  it('eligible but missing current legal acceptance is sent to /begin', async () => {
    const supabase = fakeSupabase({
      profile: { id: 'u1', onboarding_stage: 'complete' },
      eligibility: { status: 'eligible' },
      legalRows: [],
    })

    const destination = await resolvePostAuthDestination(supabase, 'u1', '/home')
    expect(destination).toBe('/begin?next=%2Fhome')
  })

  it('eligible + legally current + no profile goes to /profile, not /begin', async () => {
    const supabase = fakeSupabase({ profile: null, eligibility: { status: 'eligible' }, legalRows: CURRENT_LEGAL_ROWS })

    const destination = await resolvePostAuthDestination(supabase, 'new-user', '/home')
    expect(destination).toBe('/profile')
  })

  it.each([
    ['mark', '/profile/mark'],
    ['question', '/profile/question'],
  ])('does not let a %s-stage member use the requested destination to bypass onboarding', async (stage, expected) => {
    const supabase = fakeSupabase({
      profile: { id: 'u1', onboarding_stage: stage },
      eligibility: { status: 'eligible' },
      legalRows: CURRENT_LEGAL_ROWS,
    })

    const destination = await resolvePostAuthDestination(supabase, 'u1', '/letters')
    expect(destination).toBe(expected)
  })
})


describe('language-first post-auth destinations', () => {
  it('sends a new unconfirmed member to Language before eligibility', async () => {
    expect(await resolvePostAuthDestination(fakeSupabase({ languageConfirmed: false }), 'new-user', '/room')).toBe('/language')
  })
  it('preserves existing entry behavior when the migration is missing', async () => {
    expect(await resolvePostAuthDestination(fakeSupabase({ languageError: true }), 'new-user', '/room')).toBe('/begin?next=%2Froom')
  })
})
