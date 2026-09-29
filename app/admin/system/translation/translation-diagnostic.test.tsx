import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SECRET_KEY = 'azure-secret-key-must-never-render-9f3c'
const SECRET_ENDPOINT = 'https://secret-endpoint.example.invalid'
const SECRET_SERVICE_KEY = 'service-role-secret-must-never-render'

type Call = { kind: 'rpc' | 'from'; name: string; args?: unknown }

const state = {
  staff: true,
  staffRole: null as string | null,
  calls: [] as Call[],
  reserveAllowed: true,
  reserveError: null as { message: string } | null,
  reservedTotal: 1_234,
  azure: 'ok' as 'ok' | 'fail',
  azureCalls: [] as Array<{ text: string; targetLanguage: string; sourceLanguage?: string }>,
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/admin', () => ({
  isStaff: async (_supabase: unknown, role: string) => {
    state.staffRole = role
    return state.staff
  },
}))

// A fake service-role client that records every table/RPC touched, so the
// tests can prove the chain reserves quota and never reaches translation_cache.
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: async (name: string, args: unknown) => {
      state.calls.push({ kind: 'rpc', name, args })
      if (state.reserveError) return { data: null, error: state.reserveError }
      return { data: [{ allowed: state.reserveAllowed, reserved_total: state.reservedTotal }], error: null }
    },
    from: (name: string) => {
      state.calls.push({ kind: 'from', name })
      const query = {
        select: () => query,
        eq: () => query,
        match: () => query,
        maybeSingle: async () => ({ data: { reserved_characters: state.reservedTotal }, error: null }),
        upsert: async () => ({ error: null }),
      }
      return query
    },
  }),
}))

// Only the outbound HTTP adapter is faked; lib/translation/service.ts runs for real.
vi.mock('@/lib/translation/azure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/translation/azure')>()
  return {
    ...actual,
    translateWithAzure: async (input: { text: string; targetLanguage: string; sourceLanguage?: string }) => {
      state.azureCalls.push(input)
      if (state.azure === 'fail') throw new actual.TranslationProviderError('Azure Translator request failed (401).', 401)
      return { translatedText: 'La traducción de Tempa está conectada y funcionando.', detectedLanguage: null }
    },
  }
})

vi.mock('@/lib/translation/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/translation/service')>()
  return { ...actual, translatePrivateText: vi.fn(actual.translatePrivateText) }
})

const { runTranslationConnectionTest } = await import('./actions')
const { translatePrivateText } = await import('@/lib/translation/service')
const { DIAGNOSTIC_TEST_SENTENCE, translationReadiness } = await import('@/lib/translation/diagnostic')
const { default: TranslationDiagnosticView, DiagnosticResult } = await import('./translation-diagnostic-view')

const ENV_KEYS = [
  'AZURE_TRANSLATOR_KEY',
  'AZURE_TRANSLATOR_ENDPOINT',
  'TRANSLATION_MONTHLY_CHARACTER_LIMIT',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  process.env.AZURE_TRANSLATOR_KEY = SECRET_KEY
  process.env.AZURE_TRANSLATOR_ENDPOINT = SECRET_ENDPOINT
  process.env.TRANSLATION_MONTHLY_CHARACTER_LIMIT = '1800000'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET_SERVICE_KEY
  Object.assign(state, {
    staff: true,
    staffRole: null,
    calls: [],
    reserveAllowed: true,
    reserveError: null,
    reservedTotal: 1_234,
    azure: 'ok',
    azureCalls: [],
  })
  vi.mocked(translatePrivateText).mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.restoreAllMocks()
})

function expectNoSecrets(value: string) {
  expect(value).not.toContain(SECRET_KEY)
  expect(value).not.toContain(SECRET_ENDPOINT)
  expect(value).not.toContain(SECRET_SERVICE_KEY)
}

describe('Translation diagnostic — authorization', () => {
  it('non-staff cannot run it: refused before any quota reservation or provider call', async () => {
    state.staff = false
    expect(await runTranslationConnectionTest()).toEqual({ status: 'forbidden' })
    expect(translatePrivateText).not.toHaveBeenCalled()
    expect(state.calls).toEqual([])
    expect(state.azureCalls).toEqual([])
  })

  it('the action checks admin server-side itself', async () => {
    await runTranslationConnectionTest()
    expect(state.staffRole).toBe('admin')
    const actionSource = readFileSync(path.join(__dirname, 'actions.ts'), 'utf8')
    expect(actionSource.trimStart().startsWith("'use server'")).toBe(true)
    expect(actionSource).toContain("isStaff(supabase, 'admin')")
  })
})

describe('Translation diagnostic — fixed server-owned input', () => {
  it('the action takes no arguments', () => {
    expect(runTranslationConnectionTest.length).toBe(0)
    const actionSource = readFileSync(path.join(__dirname, 'actions.ts'), 'utf8')
    expect(actionSource).toMatch(/export async function runTranslationConnectionTest\(\)/)
  })

  it('the page renders no text input — only the Run connection test button', () => {
    const html = renderToStaticMarkup(<TranslationDiagnosticView readiness={translationReadiness()} />)
    expect(html).not.toMatch(/<(input|textarea|select)\b/)
    expect(html).not.toContain('contenteditable')
    expect(html).toContain('Run connection test')
    const viewSource = readFileSync(path.join(__dirname, 'translation-diagnostic-view.tsx'), 'utf8')
    expect(viewSource).toContain('runTranslationConnectionTest()')
  })

  it('translates exactly the fixed sentence from en to es', async () => {
    await runTranslationConnectionTest()
    expect(translatePrivateText).toHaveBeenCalledTimes(1)
    expect(translatePrivateText).toHaveBeenCalledWith({
      text: 'Tempa translation is connected and working.',
      sourceLanguage: 'en',
      targetLanguage: 'es',
    })
    expect(state.azureCalls).toEqual([{ text: DIAGNOSTIC_TEST_SENTENCE, sourceLanguage: 'en', targetLanguage: 'es' }])
  })

  it('no general translate API route exists', () => {
    const apiDir = path.join(__dirname, '..', '..', '..', 'api')
    expect(() => readFileSync(path.join(apiDir, 'translate', 'route.ts'))).toThrow()
  })
})

describe('Translation diagnostic — uses the real Tempa chain', () => {
  it('invokes translatePrivateText (quota reservation + adapter), with no Azure or fetch of its own', async () => {
    const result = await runTranslationConnectionTest()
    expect(result.status).toBe('connected')
    expect(state.calls.filter((c) => c.kind === 'rpc')).toEqual([
      {
        kind: 'rpc',
        name: 'reserve_translation_characters',
        args: { p_characters: Array.from(DIAGNOSTIC_TEST_SENTENCE).length, p_limit: 1_800_000 },
      },
    ])

    const diagnosticSource = readFileSync(path.join(__dirname, '..', '..', '..', '..', 'lib', 'translation', 'diagnostic.ts'), 'utf8')
    expect(diagnosticSource).toContain('translatePrivateText(')
    expect(diagnosticSource).not.toMatch(/translatePublicText\(|import \{[^}]*translatePublicText/)
    expect(diagnosticSource).not.toContain('translateWithAzure')
    expect(diagnosticSource).not.toMatch(/\bfetch\(/)
    expect(diagnosticSource).not.toContain('microsofttranslator')
  })

  it('never touches translation_cache', async () => {
    await runTranslationConnectionTest()
    const tables = state.calls.filter((c) => c.kind === 'from').map((c) => c.name)
    expect(tables).not.toContain('translation_cache')
    expect(tables).toEqual(['translation_usage_monthly'])
  })

  it('reports usage from translation_usage_monthly against the configured ceiling', async () => {
    const result = await runTranslationConnectionTest()
    if (result.status !== 'connected') throw new Error('expected connected')
    expect(result).toMatchObject({
      provider: 'azure',
      sourceLanguage: 'en',
      targetLanguage: 'es',
      translatedText: 'La traducción de Tempa está conectada y funcionando.',
    })
    expect(result.usage).toMatchObject({
      reservedCharacters: 1_234,
      monthlyLimit: 1_800_000,
      remainingCharacters: 1_798_766,
      percentUsed: 0.07,
    })
    expect(typeof result.responseTimeMs).toBe('number')
    expect(Number.isNaN(Date.parse(result.testedAt))).toBe(false)
  })
})

describe('Translation diagnostic — admin-safe failures', () => {
  it('missing key: fails fast as missing configuration, reserves nothing', async () => {
    delete process.env.AZURE_TRANSLATOR_KEY
    const result = await runTranslationConnectionTest()
    expect(result).toMatchObject({ status: 'failed', failure: 'missing_configuration' })
    expect(state.calls.filter((c) => c.kind === 'rpc')).toEqual([])
    expect(translatePrivateText).not.toHaveBeenCalled()
  })

  it('quota exhausted', async () => {
    state.reserveAllowed = false
    expect(await runTranslationConnectionTest()).toMatchObject({ status: 'failed', failure: 'quota_exhausted' })
    expect(state.azureCalls).toEqual([])
  })

  it('Azure/provider failure', async () => {
    state.azure = 'fail'
    expect(await runTranslationConnectionTest()).toMatchObject({
      status: 'failed',
      failure: 'provider_failure',
      message: 'Azure Translator request failed (401).',
    })
  })

  it('database/quota failure hides the raw database message', async () => {
    state.reserveError = { message: 'permission denied for function reserve_translation_characters' }
    const result = await runTranslationConnectionTest()
    expect(result).toMatchObject({ status: 'failed', failure: 'database_failure' })
    expect(JSON.stringify(result)).not.toContain('permission denied')
  })
})

describe('Translation diagnostic — no secret is returned, rendered or logged', () => {
  it('readiness reports booleans only', () => {
    const readiness = translationReadiness()
    expect(Object.values(readiness).every((v) => typeof v === 'boolean')).toBe(true)
    expectNoSecrets(renderToStaticMarkup(<TranslationDiagnosticView readiness={readiness} />))
  })

  it('success and every failure: neither the action result nor the rendered result contains a secret', async () => {
    const scenarios: Array<() => void> = [
      () => {},
      () => (state.azure = 'fail'),
      () => (state.reserveAllowed = false),
      () => (state.reserveError = { message: `bad key ${SECRET_SERVICE_KEY}` }),
      () => delete process.env.AZURE_TRANSLATOR_KEY,
    ]
    for (const setup of scenarios) {
      setup()
      const result = await runTranslationConnectionTest()
      expectNoSecrets(JSON.stringify(result))
      expectNoSecrets(renderToStaticMarkup(<DiagnosticResult result={result} />))
    }
    for (const call of vi.mocked(console.error).mock.calls) expectNoSecrets(JSON.stringify(call))
  })
})
