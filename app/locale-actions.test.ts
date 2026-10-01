import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const state = {
  cookieSets: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
  user: null as { id: string } | null,
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  tables: [] as string[],
  rpcError: null as { message: string } | null,
}

vi.mock('next/headers', () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => state.cookieSets.push({ name, value, options }),
    get: () => undefined,
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (name: string, args: { p_language?: string; p_locale?: string }) => {
      state.rpcCalls.push({ name, args })
      const returned = args.p_language ?? args.p_locale ?? null
      return state.rpcError ? { data: null, error: state.rpcError } : { data: returned, error: null }
    },
    from: (table: string) => {
      state.tables.push(table)
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

const fetchSpy = vi.fn()

beforeEach(() => {
  state.cookieSets = []
  state.user = null
  state.rpcCalls = []
  state.tables = []
  state.rpcError = null
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

const { setInterfaceLanguage, chooseTempaLanguage } = await import('./locale-actions')
const { saveReadingLanguage } = await import('./reading-language-actions')

function expectNoTranslationSpend() {
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(state.rpcCalls.map((c) => c.name)).not.toContain('reserve_translation_characters')
  expect(state.tables).not.toContain('translation_cache')
}

describe('setInterfaceLanguage (the pre-sign-in control)', () => {
  it('a valid interface language sets tempa_locale with safe cookie options', async () => {
    expect(await setInterfaceLanguage('fr')).toEqual({ ok: true, locale: 'fr' })
    expect(state.cookieSets).toEqual([{
      name: 'tempa_locale', value: 'fr',
      options: { path: '/', sameSite: 'lax', maxAge: 31_536_000, httpOnly: true, secure: false },
    }])
  })

  it('an invalid language is rejected and nothing is written', async () => {
    for (const bad of ['de', 'FR', '', '../en', 'fr; Path=/admin', 'ja']) expect(await setInterfaceLanguage(bad)).toEqual({ ok: false })
    expect(state.cookieSets).toEqual([])
  })

  it('never attempts a member database write — signed in or not', async () => {
    await setInterfaceLanguage('es')
    state.user = { id: 'u1' }
    await setInterfaceLanguage('pt')
    expect(state.rpcCalls).toEqual([])
    expectNoTranslationSpend()
  })

  it('takes only a language code and never redirects itself', () => {
    expect(setInterfaceLanguage.length).toBe(1)
    const source = readFileSync(path.join(__dirname, 'locale-actions.ts'), 'utf8')
    expect(source).not.toMatch(/redirect\(|permanentRedirect\(/)
  })
})

describe('chooseTempaLanguage (primary / onboarding choice)', () => {
  it('signed in: one atomic RPC saves interface + initial translation language, then cookie', async () => {
    state.user = { id: 'u1' }
    expect(await chooseTempaLanguage('fr')).toEqual({ ok: true, locale: 'fr' })
    expect(state.rpcCalls).toEqual([{ name: 'set_my_tempa_language', args: { p_locale: 'fr' } }])
    expect(state.cookieSets.map((c) => [c.name, c.value])).toEqual([['tempa_locale', 'fr']])
    expectNoTranslationSpend()
  })

  it('signed out: refused, no database write, no cookie', async () => {
    expect(await chooseTempaLanguage('fr')).toEqual({ ok: false })
    expect(state.rpcCalls).toEqual([])
    expect(state.cookieSets).toEqual([])
  })

  it('invalid interface language is refused before anything else', async () => {
    state.user = { id: 'u1' }
    expect(await chooseTempaLanguage('ja')).toEqual({ ok: false })
    expect(state.rpcCalls).toEqual([])
    expect(state.cookieSets).toEqual([])
  })

  it('failed durable save changes no cookie', async () => {
    state.user = { id: 'u1' }
    state.rpcError = { message: 'db down' }
    expect(await chooseTempaLanguage('es')).toEqual({ ok: false })
    expect(state.cookieSets).toEqual([])
  })
})

describe('Translation language alone', () => {
  it('changes reading_language only — the interface cookie is untouched', async () => {
    state.user = { id: 'u1' }
    expect(await saveReadingLanguage('ja')).toEqual({ ok: true, code: 'ja' })
    expect(state.rpcCalls).toEqual([{ name: 'set_my_reading_language', args: { p_language: 'ja' } }])
    expect(state.cookieSets).toEqual([])
    expectNoTranslationSpend()
  })
})

describe('UI localization never touches member-content translation', () => {
  it('no locale/i18n module imports the translation service, Azure or its cache', () => {
    const files = ['locale-actions.ts', 'language-switcher.tsx', '../i18n/config.ts', '../i18n/request.ts', 'app-shell.tsx', 'sign-in/page.tsx', 'you/language/page.tsx', 'you/language/language-settings-editor.tsx', 'language/page.tsx']
    for (const file of files) {
      const source = readFileSync(path.join(__dirname, file), 'utf8')
      expect(source, file).not.toMatch(/lib\/translation|translatePrivate|translatePublic|azure|translation_cache|reserve_translation_characters/i)
    }
  })
})
