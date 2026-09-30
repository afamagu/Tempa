/**
 * The shape of a translated field as it leaves the server — plain data, no
 * HTML strings. Client-safe (no server-only imports): reading surfaces
 * render it with ordinary React elements (app/translated-prose.tsx), so
 * translated text is always inert text nodes and never markup.
 *
 * A body is an array of paragraphs aligned 1:1, by index, with the original
 * body's paragraphs (lib/moments.ts splitParagraphs), so Moments and
 * reading-position tracking keep using canonical paragraph positions.
 */

export type TranslatedSegment = { text: string; bold: boolean; italic: boolean }
export type TranslatedParagraph = TranslatedSegment[]

export type TranslatedField =
  | { kind: 'text'; text: string }
  | { kind: 'body'; paragraphs: TranslatedParagraph[] }

const MAX_STORED_PARAGRAPHS = 1_000

function isSegment(value: unknown): value is TranslatedSegment {
  if (!value || typeof value !== 'object') return false
  const segment = value as Record<string, unknown>
  return (
    typeof segment.text === 'string' &&
    typeof segment.bold === 'boolean' &&
    typeof segment.italic === 'boolean' &&
    Object.keys(segment).length === 3
  )
}

/**
 * Serialise for translation_cache.translated_text. Only ever called with a
 * value the sanitizer produced.
 */
export function serializeTranslatedField(field: TranslatedField): string {
  return JSON.stringify(field.kind === 'text' ? { kind: 'text', text: field.text } : { kind: 'body', paragraphs: field.paragraphs })
}

/**
 * Parse a cached value back, re-validating its exact shape. Anything
 * unexpected is a cache MISS (null) — never rendered, never trusted.
 */
export function parseStoredTranslatedField(raw: unknown): TranslatedField | null {
  if (typeof raw !== 'string') return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>

  if (record.kind === 'text' && typeof record.text === 'string' && Object.keys(record).length === 2) {
    return { kind: 'text', text: record.text }
  }

  if (
    record.kind === 'body' &&
    Array.isArray(record.paragraphs) &&
    Object.keys(record).length === 2 &&
    record.paragraphs.length <= MAX_STORED_PARAGRAPHS &&
    record.paragraphs.every((paragraph) => Array.isArray(paragraph) && paragraph.every(isSegment))
  ) {
    return {
      kind: 'body',
      paragraphs: (record.paragraphs as TranslatedSegment[][]).map((paragraph) =>
        paragraph.map(({ text, bold, italic }) => ({ text, bold, italic }))
      ),
    }
  }

  return null
}

/** The plain words of a translated field (e.g. for a title attribute). */
export function translatedFieldText(field: TranslatedField): string {
  if (field.kind === 'text') return field.text
  return field.paragraphs.map((paragraph) => paragraph.map((segment) => segment.text).join('')).join('\n\n')
}
