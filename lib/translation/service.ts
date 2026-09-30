import 'server-only'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import {
  AZURE_TRANSLATOR_PROVIDER,
  AZURE_TRANSLATOR_VERSION,
  translateTextsWithAzure,
  translateWithAzure,
} from '@/lib/translation/azure'
import {
  bodyToProviderParagraphs,
  providerHtmlToSegments,
  providerHtmlToText,
  textToProviderHtml,
} from '@/lib/translation/provider-html'
import {
  parseStoredTranslatedField,
  serializeTranslatedField,
  type TranslatedField,
  type TranslatedParagraph,
} from '@/lib/translation/translated-content'
import { readingLanguage } from '@/lib/reading-languages'

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

// ============================================================
// FIELD TRANSLATION — several related authored fields, one provider call
// ============================================================
//
// A product surface (a Dispatch, a Letter) passes its canonical, server-
// loaded fields keyed by name — never text from the browser. Titles, Reveal
// Lines and Postcard back messages are `text` fields; stored Letter/Dispatch
// bodies are `body` fields whose restrained Bold/Italic/paragraph structure
// is preserved through Tempa-generated HTML (lib/translation/provider-html.ts).
//
// Accounting: every string placed in the Azure request is built FIRST, the
// quota is reserved for exactly the sum of those strings (markup included),
// and those same strings are sent. Nothing is added after reservation.

/** Separates field-level cache rows (structured JSON) from v1
 * translatePublicText rows (plain text) for the same content. */
export const FIELD_TRANSLATION_PROVIDER_VERSION = `${AZURE_TRANSLATOR_VERSION}/tempa-fields-1`
const FIELD_REPRESENTATION = 'tempa-fields-1'

/** Azure v3 per-request limits: 50,000 characters and 1,000 elements. One
 * operation is one request, so a field set larger than that is refused
 * before any quota is reserved. */
export const MAX_FIELD_PROVIDER_CHARACTERS = 50_000
export const MAX_FIELD_PROVIDER_ELEMENTS = 1_000
const MAX_FIELDS = 8
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/

export type TranslationFieldSource = { kind: 'text'; text: string } | { kind: 'body'; body: string }

export type FieldTranslationResult<K extends string> = {
  targetLanguage: string
  /** The explicit source language, else the provider's detection for the
   * largest translated field (null when nothing needed translating). */
  sourceLanguage: string | null
  fields: Record<K, TranslatedField>
  detectedLanguages: Partial<Record<K, string | null>>
  provider: typeof AZURE_TRANSLATOR_PROVIDER | 'none'
  /** Characters reserved by THIS call — 0 for a same-language or all-cache-hit result. */
  reservedCharacters: number
  cachedFields: K[]
}

export class UnsupportedTranslationLanguageError extends Error {
  constructor() {
    super('That language is not available for translation.')
    this.name = 'UnsupportedTranslationLanguageError'
  }
}

export class TranslationTooLongError extends Error {
  constructor() {
    super('This writing is too long to translate at once.')
    this.name = 'TranslationTooLongError'
  }
}

type PreparedField<K extends string> = {
  key: K
  kind: 'text' | 'body'
  /** Exact provider strings; null = nothing to translate at that position. */
  units: (string | null)[]
  providerCharacters: number
  fingerprint: string
}

function supportedLanguage(value: string | undefined, required: boolean): string | undefined {
  if (value == null) {
    if (required) throw new UnsupportedTranslationLanguageError()
    return undefined
  }
  const language = readingLanguage(value)
  if (!language) throw new UnsupportedTranslationLanguageError()
  return language.code
}

function prepareFields<K extends string>(fields: Record<K, TranslationFieldSource>): PreparedField<K>[] {
  const keys = Object.keys(fields) as K[]
  if (keys.length === 0 || keys.length > MAX_FIELDS) throw new Error('Invalid translation field set.')

  return keys.map((key) => {
    if (!FIELD_KEY_RE.test(key)) throw new Error('Invalid translation field name.')
    const source = fields[key]
    let units: (string | null)[]
    if (source?.kind === 'text' && typeof source.text === 'string') units = [textToProviderHtml(source.text)]
    else if (source?.kind === 'body' && typeof source.body === 'string') units = bodyToProviderParagraphs(source.body)
    else throw new Error('Invalid translation field.')

    const providerCharacters = units.reduce((sum, unit) => sum + (unit ? characterCount(unit) : 0), 0)
    // Fingerprint the exact canonical provider representation, so a
    // formatting-only edit (e.g. adding Bold) can never reuse an old result.
    const fingerprint = sourceFingerprint(JSON.stringify([FIELD_REPRESENTATION, source.kind, units]))
    return { key, kind: source.kind, units, providerCharacters, fingerprint }
  })
}

function assertWithinRequestLimits(fields: PreparedField<string>[]) {
  const units = fields.flatMap((field) => field.units.filter((unit): unit is string => unit !== null))
  const characters = fields.reduce((sum, field) => sum + field.providerCharacters, 0)
  if (units.length > MAX_FIELD_PROVIDER_ELEMENTS || characters > MAX_FIELD_PROVIDER_CHARACTERS) {
    throw new TranslationTooLongError()
  }
  return { units, characters }
}

function fieldFromUnits(kind: 'text' | 'body', translatedUnits: (string | null)[]): TranslatedField {
  if (kind === 'text') {
    const unit = translatedUnits[0]
    return { kind: 'text', text: unit ? providerHtmlToText(unit) : '' }
  }
  const paragraphs: TranslatedParagraph[] = translatedUnits.map((unit) => (unit ? providerHtmlToSegments(unit) : []))
  return { kind: 'body', paragraphs }
}

/** Same-language / nothing-to-send: the original's own structure, through
 * the same sanitizer, with no provider call and no reservation. */
function untranslatedField(field: PreparedField<string>): TranslatedField {
  return fieldFromUnits(field.kind, field.units)
}

async function translatePreparedFields<K extends string>(
  fields: PreparedField<K>[],
  targetLanguage: string,
  sourceLanguage: string | undefined
): Promise<{
  translated: Map<K, TranslatedField>
  detected: Map<K, string | null>
  reserved: number
}> {
  const translated = new Map<K, TranslatedField>()
  const detected = new Map<K, string | null>()
  const { units, characters } = assertWithinRequestLimits(fields)

  if (units.length === 0) {
    for (const field of fields) translated.set(field.key, untranslatedField(field))
    return { translated, detected, reserved: 0 }
  }

  // Reserve exactly what is about to be sent (see requestProvider for the
  // no-refund rationale), then send those same strings.
  await reserveCharacters(characters)
  const results = await translateTextsWithAzure({ texts: units, targetLanguage, sourceLanguage, textType: 'html' })

  let cursor = 0
  for (const field of fields) {
    let largest = -1
    let fieldDetected: string | null = null
    const translatedUnits = field.units.map((unit) => {
      if (unit === null) return null
      const result = results[cursor++]
      const size = characterCount(unit)
      if (size > largest) {
        largest = size
        fieldDetected = result.detectedLanguage
      }
      return result.translatedText
    })
    translated.set(field.key, fieldFromUnits(field.kind, translatedUnits))
    detected.set(field.key, sourceLanguage ?? fieldDetected)
  }

  return { translated, detected, reserved: characters }
}

function dominantDetectedLanguage<K extends string>(
  fields: PreparedField<K>[],
  detected: Map<K, string | null>
): string | null {
  let best: string | null = null
  let bestSize = -1
  for (const field of fields) {
    const language = detected.get(field.key)
    if (language && field.providerCharacters > bestSize) {
      best = language
      bestSize = field.providerCharacters
    }
  }
  return best
}

function assemble<K extends string>(
  prepared: PreparedField<K>[],
  translated: Map<K, TranslatedField>,
  detected: Map<K, string | null>,
  targetLanguage: string,
  sourceLanguage: string | undefined,
  reserved: number,
  cachedFields: K[],
  provider: FieldTranslationResult<K>['provider']
): FieldTranslationResult<K> {
  const fields = {} as Record<K, TranslatedField>
  const detectedLanguages: Partial<Record<K, string | null>> = {}
  for (const field of prepared) {
    fields[field.key] = translated.get(field.key) ?? untranslatedField(field)
    if (detected.has(field.key)) detectedLanguages[field.key] = detected.get(field.key) ?? null
  }
  return {
    targetLanguage,
    sourceLanguage: sourceLanguage ?? dominantDetectedLanguage(prepared, detected),
    fields,
    detectedLanguages,
    provider,
    reservedCharacters: reserved,
    cachedFields,
  }
}

function isSameLanguage(sourceLanguage: string | undefined, targetLanguage: string) {
  return sourceLanguage?.toLowerCase() === targetLanguage.toLowerCase()
}

/**
 * PRIVATE member writing (a Letter body, its letter-level Postcard Reveal
 * Line and back message). Never reads or writes translation_cache and
 * persists nothing: the result exists only in the caller's response. The
 * calling surface must already have authorised the reader for this content.
 */
export async function translatePrivateFields<K extends string>(input: {
  fields: Record<K, TranslationFieldSource>
  targetLanguage: string
  sourceLanguage?: string
}): Promise<FieldTranslationResult<K>> {
  // Validate languages and size before anything that could reserve quota.
  const targetLanguage = supportedLanguage(input.targetLanguage, true)!
  const sourceLanguage = supportedLanguage(input.sourceLanguage, false)
  const prepared = prepareFields(input.fields)
  assertWithinRequestLimits(prepared)

  if (isSameLanguage(sourceLanguage, targetLanguage)) {
    return assemble(prepared, new Map(), new Map(), targetLanguage, sourceLanguage, 0, [], 'none')
  }

  const { translated, detected, reserved } = await translatePreparedFields(prepared, targetLanguage, sourceLanguage)
  return assemble(
    prepared,
    translated,
    detected,
    targetLanguage,
    sourceLanguage,
    reserved,
    [],
    reserved > 0 ? AZURE_TRANSLATOR_PROVIDER : 'none'
  )
}

export type PublicFieldCacheRef = {
  contentType: string
  contentId: string
  contentVersion: string
}

type CacheRow = {
  field_name: string
  source_fingerprint: string
  translated_text: string
  detected_language: string | null
}

/**
 * PUBLIC member writing with durable, field-by-field reuse. A cache hit
 * costs zero provider characters; only misses are sent (batched in one
 * request) and each sanitized result is stored as its own row. Callers
 * must authorise the viewer for the canonical content BEFORE calling —
 * the cache is keyed by content, not by viewer, and is never a way around
 * visibility.
 */
export async function translatePublicFields<K extends string>(input: {
  fields: Record<K, TranslationFieldSource>
  targetLanguage: string
  sourceLanguage?: string
  cache: PublicFieldCacheRef
}): Promise<FieldTranslationResult<K>> {
  const targetLanguage = supportedLanguage(input.targetLanguage, true)!
  const sourceLanguage = supportedLanguage(input.sourceLanguage, false)
  const prepared = prepareFields(input.fields)
  assertWithinRequestLimits(prepared)

  if (isSameLanguage(sourceLanguage, targetLanguage)) {
    return assemble(prepared, new Map(), new Map(), targetLanguage, sourceLanguage, 0, [], 'none')
  }

  const contentType = cleanCachePart(input.cache.contentType, 'content type', 40)
  const contentId = cleanCachePart(input.cache.contentId, 'content id', 64)
  const contentVersion = cleanCachePart(input.cache.contentVersion, 'content version', 128)
  const baseKey = {
    content_type: contentType,
    content_id: contentId,
    content_version: contentVersion,
    source_language: sourceLanguage ?? 'auto',
    target_language: targetLanguage,
    provider: AZURE_TRANSLATOR_PROVIDER,
    provider_version: FIELD_TRANSLATION_PROVIDER_VERSION,
  }

  // Empty fields need no provider call and are never cached.
  const translatable = prepared.filter((field) => field.providerCharacters > 0)
  const translated = new Map<K, TranslatedField>()
  const detected = new Map<K, string | null>()
  const cachedFields: K[] = []

  if (translatable.length === 0) {
    return assemble(prepared, translated, detected, targetLanguage, sourceLanguage, 0, cachedFields, 'none')
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('translation_cache')
    .select('field_name, source_fingerprint, translated_text, detected_language')
    .match(baseKey)
    .in(
      'field_name',
      translatable.map((field) => field.key)
    )
  if (error) throw new Error(`Translation cache read failed: ${error.message}`)

  for (const row of (data ?? []) as CacheRow[]) {
    const field = translatable.find((candidate) => candidate.key === row.field_name)
    if (!field || row.source_fingerprint !== field.fingerprint || translated.has(field.key)) continue
    const stored = parseStoredTranslatedField(row.translated_text)
    if (!stored || stored.kind !== field.kind) continue
    if (stored.kind === 'body' && stored.paragraphs.length !== field.units.length) continue
    translated.set(field.key, stored)
    detected.set(field.key, sourceLanguage ?? row.detected_language)
    cachedFields.push(field.key)
  }

  const misses = translatable.filter((field) => !translated.has(field.key))
  let reserved = 0
  if (misses.length > 0) {
    const fresh = await translatePreparedFields(misses, targetLanguage, sourceLanguage)
    reserved = fresh.reserved
    const rows = misses.map((field) => {
      const result = fresh.translated.get(field.key)!
      const fieldDetected = fresh.detected.get(field.key) ?? null
      translated.set(field.key, result)
      detected.set(field.key, fieldDetected)
      return {
        ...baseKey,
        field_name: field.key,
        source_fingerprint: field.fingerprint,
        translated_text: serializeTranslatedField(result),
        detected_language: fieldDetected,
        source_character_count: field.providerCharacters,
      }
    })

    const { error: cacheWriteError } = await service.from('translation_cache').upsert(rows, {
      onConflict:
        'content_type,content_id,field_name,content_version,source_fingerprint,source_language,target_language,provider,provider_version',
      ignoreDuplicates: true,
    })
    // The reader already has a valid translation; a failed write only means
    // the next reader pays again. Never fail the read over it; never log text.
    if (cacheWriteError) console.error('[translation] public field cache write failed', { contentType })
  }

  return assemble(
    prepared,
    translated,
    detected,
    targetLanguage,
    sourceLanguage,
    reserved,
    cachedFields,
    AZURE_TRANSLATOR_PROVIDER
  )
}
