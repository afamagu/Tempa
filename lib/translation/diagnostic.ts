import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { TranslationProviderError } from '@/lib/translation/azure'
import {
  monthlyCharacterLimit,
  translatePrivateText,
  TranslationBudgetExceededError,
} from '@/lib/translation/service'

/**
 * Admin → System → Translation. A genuine end-to-end check of Tempa's
 * translation chain: staff press a button, and this runs ONE fixed,
 * server-owned sentence through translatePrivateText() — the same path
 * private Letters use — so the Supabase quota reservation and the Azure
 * adapter are both exercised for real. Deliberately:
 *   - no caller-supplied text (nothing here accepts input at all);
 *   - translatePrivateText, never translatePublicText, so nothing is
 *     written to translation_cache;
 *   - no direct Azure call — the adapter is only reached through the
 *     service, exactly as production features reach it;
 *   - results carry booleans and counts only, never a key, endpoint,
 *     header or provider response body.
 */

export const DIAGNOSTIC_TEST_SENTENCE = 'Tempa translation is connected and working.'
export const DIAGNOSTIC_SOURCE_LANGUAGE = 'en'
export const DIAGNOSTIC_TARGET_LANGUAGE = 'es'

export type TranslationReadiness = {
  keyConfigured: boolean
  endpointConfigured: boolean
  monthlyLimitConfigured: boolean
  monthlyLimitValid: boolean
  databaseConfigured: boolean
}

export type TranslationUsage = {
  monthStart: string
  reservedCharacters: number
  monthlyLimit: number
  remainingCharacters: number
  percentUsed: number
}

export type TranslationDiagnosticFailure =
  | 'missing_configuration'
  | 'quota_exhausted'
  | 'provider_failure'
  | 'database_failure'

export type TranslationDiagnosticResult =
  | {
      status: 'connected'
      provider: string
      sourceLanguage: string
      targetLanguage: string
      testSentence: string
      translatedText: string
      responseTimeMs: number
      testedAt: string
      usage: TranslationUsage | null
    }
  | {
      status: 'failed'
      failure: TranslationDiagnosticFailure
      message: string
      sourceLanguage: string
      targetLanguage: string
      responseTimeMs: number | null
      testedAt: string
      usage: TranslationUsage | null
    }

function present(name: string) {
  return Boolean(process.env[name]?.trim())
}

/** Environment readiness as booleans only — safe to render on page load
 * (costs zero translation characters, reads no values back out). */
export function translationReadiness(): TranslationReadiness {
  let monthlyLimitValid = true
  try {
    monthlyCharacterLimit()
  } catch {
    monthlyLimitValid = false
  }

  return {
    keyConfigured: present('AZURE_TRANSLATOR_KEY'),
    endpointConfigured: present('AZURE_TRANSLATOR_ENDPOINT'),
    monthlyLimitConfigured: present('TRANSLATION_MONTHLY_CHARACTER_LIMIT'),
    monthlyLimitValid,
    databaseConfigured: present('NEXT_PUBLIC_SUPABASE_URL') && present('SUPABASE_SERVICE_ROLE_KEY'),
  }
}

/** Same UTC month key reserve_translation_characters uses. */
function currentMonthStart(now: Date) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** Reads the current month's reservation total from the service-role-only
 * translation_usage_monthly table. Returns null (never throws) so a usage
 * read problem can't mask the connection result itself. */
export async function readTranslationUsage(now = new Date()): Promise<TranslationUsage | null> {
  try {
    const monthlyLimit = monthlyCharacterLimit()
    const monthStart = currentMonthStart(now)
    const { data, error } = await createServiceClient()
      .from('translation_usage_monthly')
      .select('reserved_characters')
      .eq('month_start', monthStart)
      .maybeSingle()
    if (error) return null

    const reservedCharacters = Number(data?.reserved_characters ?? 0)
    return {
      monthStart,
      reservedCharacters,
      monthlyLimit,
      remainingCharacters: Math.max(0, monthlyLimit - reservedCharacters),
      percentUsed: Math.round((reservedCharacters / monthlyLimit) * 10_000) / 100,
    }
  } catch {
    return null
  }
}

function classify(err: unknown): { failure: TranslationDiagnosticFailure; message: string } {
  if (err instanceof TranslationBudgetExceededError) {
    return { failure: 'quota_exhausted', message: "Tempa's monthly translation ceiling has been reached." }
  }
  if (err instanceof TranslationProviderError) {
    // The adapter's messages are fixed strings plus an HTTP status — they
    // never include the key, headers or the provider's response body.
    return { failure: 'provider_failure', message: err.message }
  }
  return { failure: 'database_failure', message: 'The translation quota reservation could not be completed.' }
}

export async function runTranslationDiagnostic(): Promise<TranslationDiagnosticResult> {
  const readiness = translationReadiness()
  const base = { sourceLanguage: DIAGNOSTIC_SOURCE_LANGUAGE, targetLanguage: DIAGNOSTIC_TARGET_LANGUAGE }

  // Fail fast before reserving anything: a missing key would otherwise
  // still spend a (non-refunded) reservation before Azure is reached.
  const missing = [
    !readiness.keyConfigured && 'translator key',
    !readiness.monthlyLimitValid && 'valid monthly character limit',
    !readiness.databaseConfigured && 'database service credentials',
  ].filter(Boolean)
  if (missing.length > 0) {
    return {
      status: 'failed',
      failure: 'missing_configuration',
      message: `Missing configuration: ${missing.join(', ')}.`,
      ...base,
      responseTimeMs: null,
      testedAt: new Date().toISOString(),
      usage: readiness.databaseConfigured ? await readTranslationUsage() : null,
    }
  }

  const started = performance.now()
  try {
    const result = await translatePrivateText({
      text: DIAGNOSTIC_TEST_SENTENCE,
      sourceLanguage: DIAGNOSTIC_SOURCE_LANGUAGE,
      targetLanguage: DIAGNOSTIC_TARGET_LANGUAGE,
    })
    const responseTimeMs = Math.round(performance.now() - started)
    return {
      status: 'connected',
      provider: result.provider,
      ...base,
      testSentence: DIAGNOSTIC_TEST_SENTENCE,
      translatedText: result.translatedText,
      responseTimeMs,
      testedAt: new Date().toISOString(),
      usage: await readTranslationUsage(),
    }
  } catch (err) {
    const responseTimeMs = Math.round(performance.now() - started)
    const { failure, message } = classify(err)
    // Category and error class only — no message bodies, headers or text.
    console.error('[admin] translation diagnostic failed', {
      failure,
      error: err instanceof Error ? err.name : 'unknown',
    })
    return {
      status: 'failed',
      failure,
      message,
      ...base,
      responseTimeMs,
      testedAt: new Date().toISOString(),
      usage: await readTranslationUsage(),
    }
  }
}
