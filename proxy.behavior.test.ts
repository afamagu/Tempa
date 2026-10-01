import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LOCALE_COOKIE } from '@/i18n/config'
import { NextRequest } from 'next/server'
import { CURRENT_TERMS_VERSION, CURRENT_COMMUNITY_GUIDELINES_VERSION } from '@/lib/legal'

// Behavioral proxy tests: the real proxy() against a fake Supabase
// client, counting every auth/DB operation on the protected-entry path.

type EntryRow = {
  account_status: string
  eligibility_status: string | null
  has_profile: boolean
  onboarding_stage: string | null
  terms_current: boolean
  guidelines_current: boolean
}

const fake = {
  user: null as { id: string } | null,
  entryRow: null as EntryRow | null,
  entryError: null as { message: string } | null,
  legacy: {
    status: 'active',
    profile: null as { id: string; onboarding_stage: string } | null,
    eligibility: null as { status: string } | null,
    legal: [] as { document_type: string; document_version: string }[],
  },
  language: { language_confirmed_at: '2026-09-30T00:00:00Z', interface_locale: null } as { language_confirmed_at: string | null; interface_locale: string | null } | null,
  languageError: null as { message: string } | null,
  refreshCookie: false,
  ops: [] as string[],
  rpcArgs: [] as unknown[],
}

function query(table: string) {
  const result = () => {
    if (table === 'member_language_preferences') return { data: fake.language, error: fake.languageError }
    if (table === 'profiles') return { data: fake.legacy.profile }
    if (table === 'account_eligibility') return { data: fake.legacy.eligibility }
    return { data: fake.legacy.legal }
  }
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result(),
    then: (resolve: (v: unknown) => void) => resolve(result()),
  }
  return chain
}

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (cookies: { name: string; value: string; options: { path: string; httpOnly: boolean } }[]) => void } }) => ({
    auth: {
      getUser: async () => {
        fake.ops.push('auth.getUser')
        if (fake.refreshCookie) options.cookies.setAll([{ name: 'sb-session', value: 'refreshed', options: { path: '/', httpOnly: true } }])
        return { data: { user: fake.user } }
      },
    },
    rpc: async (fn: string, args?: unknown) => {
      fake.ops.push(`rpc:${fn}`)
      fake.rpcArgs.push(args)
      if (fn === 'current_account_entry_state') {
        return fake.entryError ? { data: null, error: fake.entryError } : { data: fake.entryRow ? [fake.entryRow] : [], error: null }
      }
      if (fn === 'current_account_status') return { data: fake.legacy.status, error: null }
      return { data: null, error: { message: 'unknown rpc' } }
    },
    from: (table: string) => {
      fake.ops.push(`from:${table}`)
      return query(table)
    },
  }),
}))

const { proxy } = await import('./proxy')

const complete: EntryRow = {
  account_status: 'active',
  eligibility_status: 'eligible',
  has_profile: true,
  onboarding_stage: 'complete',
  terms_current: true,
  guidelines_current: true,
}

async function visit(pathWithSearch: string) {
  const res = await proxy(new NextRequest(new URL(pathWithSearch, 'https://tempa.test')))
  const location = res.headers.get('location')
  return location ? new URL(location) : null
}

beforeEach(() => {
  fake.user = { id: 'viewer' }
  fake.entryRow = { ...complete }
  fake.entryError = null
  fake.language = { language_confirmed_at: '2026-09-30T00:00:00Z', interface_locale: null }
  fake.languageError = null
  fake.legacy = { status: 'active', profile: null, eligibility: null, legal: [] }
  fake.refreshCookie = false
  fake.ops = []
  fake.rpcArgs = []
})

describe('proxy — protected entry destinations', () => {
  it('unauthenticated -> /sign-in with next=<requested path>, no account-state read', async () => {
    fake.user = null
    const to = await visit('/letters/abc?x=1')
    expect(to?.pathname).toBe('/sign-in')
    expect(to?.searchParams.get('next')).toBe('/letters/abc?x=1')
    expect(fake.ops).toEqual(['auth.getUser'])
  })

  it('eligible, legally current, complete profile -> passes through', async () => {
    expect(await visit('/home')).toBeNull()
  })

  it('banned -> /account-unavailable (before any other gate)', async () => {
    fake.entryRow = { ...complete, account_status: 'banned', eligibility_status: null }
    expect((await visit('/home'))?.pathname).toBe('/account-unavailable')
  })

  it('restricted/suspended members still navigate (only a ban blocks entry)', async () => {
    fake.entryRow = { ...complete, account_status: 'restricted' }
    expect(await visit('/home')).toBeNull()
  })

  it('a member taking a break lands on /account-paused from any protected route (never silently reactivated)', async () => {
    fake.entryRow = { ...complete, account_status: 'deactivated' }
    for (const path of ['/home', '/letters/abc', '/you/account']) {
      expect((await visit(path))?.pathname).toBe('/account-paused')
    }
  })

  it('a closed account’s leftover session goes to /account-deleted, not the ban notice', async () => {
    fake.entryRow = { ...complete, account_status: 'closed' }
    expect((await visit('/home'))?.pathname).toBe('/account-deleted')
  })

  it('no eligibility / ineligible / review -> /begin?next=', async () => {
    for (const eligibility_status of [null, 'ineligible', 'review_required']) {
      fake.entryRow = { ...complete, eligibility_status }
      const to = await visit('/minds')
      expect(to?.pathname).toBe('/begin')
      expect(to?.searchParams.get('next')).toBe('/minds')
    }
  })

  it('missing either current legal acceptance -> /begin', async () => {
    fake.entryRow = { ...complete, terms_current: false }
    expect((await visit('/home'))?.pathname).toBe('/begin')
    fake.entryRow = { ...complete, guidelines_current: false }
    expect((await visit('/home'))?.pathname).toBe('/begin')
  })

  it('incomplete profile/onboarding -> the existing onboarding destinations', async () => {
    fake.entryRow = { ...complete, has_profile: false, onboarding_stage: null }
    expect((await visit('/home'))?.pathname).toBe('/profile')
    fake.entryRow = { ...complete, onboarding_stage: 'mark' }
    expect((await visit('/home'))?.pathname).toBe('/profile/mark')
    fake.entryRow = { ...complete, onboarding_stage: 'question' }
    expect((await visit('/home'))?.pathname).toBe('/profile/question')
  })
})

describe('proxy — consolidated account-entry read', () => {
  it('normal authenticated entry = auth.getUser + ONE self-scoped RPC (was: getUser + status RPC + 3 table reads)', async () => {
    await visit('/home')
    expect(fake.ops).toEqual(['auth.getUser', 'rpc:current_account_entry_state', 'from:member_language_preferences'])
  })

  it('passes only the server-side legal version constants — never a user id', async () => {
    await visit('/home')
    expect(fake.rpcArgs[0]).toEqual({
      p_terms_version: CURRENT_TERMS_VERSION,
      p_guidelines_version: CURRENT_COMMUNITY_GUIDELINES_VERSION,
    })
  })

  it('falls back to the legacy reads when the RPC is unavailable — same destinations, never a blanket /begin', async () => {
    fake.entryError = { message: 'function does not exist' }
    fake.legacy = {
      status: 'active',
      profile: { id: 'viewer', onboarding_stage: 'complete' },
      eligibility: { status: 'eligible' },
      legal: [
        { document_type: 'terms_of_service', document_version: CURRENT_TERMS_VERSION },
        { document_type: 'community_guidelines', document_version: CURRENT_COMMUNITY_GUIDELINES_VERSION },
      ],
    }
    expect(await visit('/home')).toBeNull()
    expect(fake.ops).toContain('rpc:current_account_status')

    fake.legacy.status = 'banned'
    expect((await visit('/home'))?.pathname).toBe('/account-unavailable')
  })
})


describe('proxy — language confirmation and durable cookies', () => {
  it('gates direct Room access before DOB/legal or profile setup', async () => {
    fake.language = null
    fake.entryRow = { ...complete, has_profile: false, eligibility_status: null }
    expect((await visit('/room'))?.pathname).toBe('/language')
    expect(await visit('/language')).toBeNull()
  })

  it('keeps account restrictions ahead of the language gate', async () => {
    fake.language = null
    fake.entryRow = { ...complete, account_status: 'banned' }
    expect((await visit('/room'))?.pathname).toBe('/account-unavailable')
  })

  it('does not lock members out when the language migration is unavailable', async () => {
    fake.language = null
    fake.languageError = { message: 'column does not exist' }
    expect(await visit('/room')).toBeNull()
  })

  it.each(['/room', '/begin'])('preserves the saved locale and refreshed session on %s', async (path) => {
    fake.refreshCookie = true
    fake.language = { language_confirmed_at: '2026-09-30T00:00:00Z', interface_locale: 'fr' }
    fake.entryRow = { ...complete, eligibility_status: null }
    const response = await proxy(new NextRequest(new URL(path, 'https://tempa.test')))
    expect(response.cookies.get('sb-session')?.value).toBe('refreshed')
    expect(response.cookies.get(LOCALE_COOKIE)?.value).toBe('fr')
    expect(response.cookies.get(LOCALE_COOKIE)?.httpOnly).toBe(true)
    if (path === '/room') expect(new URL(response.headers.get('location')!).pathname).toBe('/begin')
    else expect(response.headers.get('location')).toBeNull()
  })

  it('preserves refreshed session cookies on sign-in redirects', async () => {
    fake.refreshCookie = true
    fake.user = null
    const response = await proxy(new NextRequest('https://tempa.test/room'))
    expect(response.cookies.get('sb-session')?.value).toBe('refreshed')
  })
})
