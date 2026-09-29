import 'server-only'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import {
  AZURE_TRANSLATOR_PROVIDER,
  AZURE_TRANSLATOR_VERSION,
  translateWithAzure,
} from '@/lib/translation/azure'

const AZURE_F0_MONTHLY_CHARACTERS = 2_000_000
const DEFAULT_MONTHLY_CHARACTER_LIMIT = 1_800_000
const MAX_TEXT_CHARACTERS = 10_000
const LANGUAGE_CODE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

export type TranslationResult = {
  translatedText: string
  detectedLanguage: string | null
  sourceLanguage: string | null
  targetLanguage: string
  provider: typeof AZURE_TRANSLATOR_PROVIDER | 'none'
  cached: boolean
  sourceCharacterCount: number
}

export type PublicTranslationCacheRef = {
  contentType: string
  contentId: string
  fieldName: string
  contentVersion: string
}

export class TranslationBudgetExceededError extends Error {
  constructor() {
    super('Tempa translation is temporarily unavailable because the monthly translation allowance has been reached.')
    this.name = 'TranslationBudgetExceededError'
  }
}

function characterCount(text: string) {
  return Array.from(text).length
}

function cleanLanguageCode(value: string | undefined, label: string): string | undefined {
  if (value == null) return undefined
  const cleaned = value.trim()
  if (!LANGUAGE_CODE_RE.test(cleaned)) throw new Error(`Invalid ${label} language code.`)
  return cleaned
}

function cleanCachePart(value: string, label: string, maxLength: number) {
  const cleaned = value.trim()
  if (!cleaned || cleaned.length > maxLength) throw new Error(`Invalid translation cache ${label}.`)
  return cleaned
}

/**
 * Tempa's own monthly ceiling — the exact value passed to
 * reserve_translation_characters. Exported so the admin diagnostic reports
 * the same number the reservation enforces instead of re-parsing the env.
 */
export function monthlyCharacterLimit() {
  const raw = process.env.TRANSLATION_MONTHLY_CHARACTER_LIMIT?.trim()
  if (!raw) return DEFAULT_MONTHLY_CHARACTER_LIMIT

  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > AZURE_F0_MONTHLY_CHARACTERS) {
    throw new Error(
      `TRANSLATION_MONTHLY_CHARACTER_LIMIT must be an integer between 1 and ${AZURE_F0_MONTHLY_CHARACTERS}.`
    )
  }
  return parsed
}

function sourceFingerprint(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function reserveCharacters(count: number) {
  const service = createServiceClient()
  const { data, error } = await service.rpc('reserve_translation_characters', {
    p_characters: count,
    p_limit: monthlyCharacterLimit(),
  })

  if (error) throw new Error(`Translation quota reservation failed: ${error.message}`)

  const row = Array.isArray(data) ? data[0] : data
  if (!row || row.allowed !== true) throw new TranslationBudgetExceededError()
}

function prepare(input: { text: string; targetLanguage: string; sourceLanguage?: string }) {
  const text = input.text
  const count = characterCount(text)
  if (count === 0) throw new Error('Translation text cannot be empty.')
  if (count > MAX_TEXT_CHARACTERS) {
    throw new Error(`Translation text cannot exceed ${MAX_TEXT_CHARACTERS} characters.`)
  }

  const targetLanguage = cleanLanguageCode(input.targetLanguage, 'target')!
  const sourceLanguage = cleanLanguageCode(input.sourceLanguage, 'source')

  return { text, count, targetLanguage, sourceLanguage }
}

async function requestProvider(input: ReturnType<typeof prepare>): Promise<TranslationResult> {
  if (input.sourceLanguage?.toLowerCase() === input.targetLanguage.toLowerCase()) {
    return {
      translatedText: input.text,
      detectedLanguage: input.sourceLanguage,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      provider: 'none',
      cached: false,
      sourceCharacterCount: input.count,
    }
  }

  // Reserve before the outbound request. Reservations are intentionally not
  // refunded on provider failure: conservative accounting can make translation
  // stop a little early, but can never let retries push Tempa past its own cap.
  await reserveCharacters(input.count)
  const result = await translateWithAzure({
    text: input.text,
    targetLanguage: input.targetLanguage,
    sourceLanguage: input.sourceLanguage,
  })

  return {
    translatedText: result.translatedText,
    detectedLanguage: result.detectedLanguage,
    sourceLanguage: input.sourceLanguage ?? result.detectedLanguage,
    targetLanguage: input.targetLanguage,
    provider: AZURE_TRANSLATOR_PROVIDER,
    cached: false,
    sourceCharacterCount: input.count,
  }
}

/**
 * Translate PRIVATE member writing (Letters, private Postcard backs, Reveal
 * Lines). This path deliberately never writes the source or translated text to
 * Tempa's translation cache. The calling surface must already have performed
 * its normal read-authorisation check before passing text here.
 */
export async function translatePrivateText(input: {
  text: string
  targetLanguage: string
  sourceLanguage?: string
}): Promise<TranslationResult> {
  return requestProvider(prepare(input))
}

/**
 * Translate PUBLIC member content with durable reuse. Callers must only use
 * this for genuinely public content and must supply a stable content/version
 * reference so deletion/edit workflows can locate and invalidate derived text.
 */
export async function translatePublicText(input: {
  text: string
  targetLanguage: string
  sourceLanguage?: string
  cache: PublicTranslationCacheRef
}): Promise<TranslationResult> {
  const prepared = prepare(input)
  if (prepared.sourceLanguage?.toLowerCase() === prepared.targetLanguage.toLowerCase()) {
    return requestProvider(prepared)
  }

  const contentType = cleanCachePart(input.cache.contentType, 'content type', 40)
  const contentId = cleanCachePart(input.cache.contentId, 'content id', 64)
  const fieldName = cleanCachePart(input.cache.fieldName, 'field name', 40)
  const contentVersion = cleanCachePart(input.cache.contentVersion, 'content version', 128)
  const fingerprint = sourceFingerprint(prepared.text)
  const sourceLanguageKey = prepared.sourceLanguage ?? 'auto'
  const service = createServiceClient()

  const cacheKey = {
    content_type: contentType,
    content_id: contentId,
    field_name: fieldName,
    content_version: contentVersion,
    source_fingerprint: fingerprint,
    source_language: sourceLanguageKey,
    target_language: prepared.targetLanguage,
    provider: AZURE_TRANSLATOR_PROVIDER,
    provider_version: AZURE_TRANSLATOR_VERSION,
  }

  const { data: cached, error: cacheReadError } = await service
    .from('translation_cache')
    .select('translated_text, detected_language')
    .match(cacheKey)
    .maybeSingle()

  if (cacheReadError) throw new Error(`Translation cache read failed: ${cacheReadError.message}`)

  if (cached) {
    return {
      translatedText: cached.translated_text,
      detectedLanguage: cached.detected_language,
      sourceLanguage: prepared.sourceLanguage ?? cached.detected_language,
      targetLanguage: prepared.targetLanguage,
      provider: AZURE_TRANSLATOR_PROVIDER,
      cached: true,
      sourceCharacterCount: prepared.count,
    }
  }

  const translated = await requestProvider(prepared)
  if (translated.provider === 'none') return translated

  const { error: cacheWriteError } = await service.from('translation_cache').upsert(
    {
      ...cacheKey,
      translated_text: translated.translatedText,
      detected_language: translated.detectedLanguage,
      source_character_count: prepared.count,
    },
    {
      onConflict:
        'content_type,content_id,field_name,content_version,source_fingerprint,source_language,target_language,provider,provider_version',
      ignoreDuplicates: true,
    }
  )

  if (cacheWriteError) throw new Error(`Translation cache write failed: ${cacheWriteError.message}`)
  return translated
}
