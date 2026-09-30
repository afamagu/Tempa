import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { RICH_BODY_MARKER } from '@/lib/letter-editor-doc'

// Transparent provider batching: Azure's 50,000-character / 1,000-element
// per-request limits are transport detail, never a Tempa document limit.
// Real service + real Azure adapter + real provider-html, against a fake
// HTTP endpoint and a recording service-role client.

type CacheRow = Record<string, unknown>
const db = {
  calls: [] as Array<{ kind: 'rpc' | 'from'; name: string; args?: unknown }>,
  reservations: [] as number[],
  cache: [] as CacheRow[],
  allow: true,
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: async (name: string, args: { p_characters: number }) => {
      db.calls.push({ kind: 'rpc', name, args })
      db.reservations.push(args.p_characters)
      return { data: [{ allowed: db.allow, reserved_total: 0 }], error: null }
    },
    from: (table: string) => {
      db.calls.push({ kind: 'from', name: table })
      const filters: Record<string, unknown> = {}
      const query = {
        select: () => query,
        match: (m: Record<string, unknown>) => {
          Object.assign(filters, m)
          return query
        },
        in: () => query,
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: db.cache.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v)), error: null }),
        upsert: async (rows: CacheRow[]) => {
          db.calls.push({ kind: 'from', name: `${table}:upsert`, args: rows })
          db.cache.push(...rows)
          return { error: null }
        },
      }
      return query
    },
  }),
}))

let requests: string[][] = []
let failOnRequest: number | null = null

// Upper-cases ASCII letters in text only — tags and entities untouched.
const fakeTranslate = (html: string) =>
  html.replace(/<[^>]*>|&[a-z]+;|[a-z]+/gi, (m) => (m.startsWith('<') || m.startsWith('&') ? m : m.toUpperCase()))

beforeEach(() => {
  db.calls = []
  db.reservations = []
  db.cache = []
  db.allow = true
  requests = []
  failOnRequest = null
  process.env.AZURE_TRANSLATOR_KEY = 'test-key'
  process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://translator.test'
  process.env.TRANSLATION_MONTHLY_CHARACTER_LIMIT = '1800000'
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const items = JSON.parse(String(init.body)) as Array<{ Text: string }>
    requests.push(items.map((item) => item.Text))
    if (failOnRequest === requests.length) return new Response('{}', { status: 503 })
    return new Response(
      JSON.stringify(items.map((item) => ({ detectedLanguage: { language: 'en', score: 1 }, translations: [{ text: fakeTranslate(item.Text) }] }))),
      { status: 200 }
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const { translatePrivateFields, translatePublicFields, partitionProviderBatches, TranslationBudgetExceededError } =
  await import('./service')
const { bodyToProviderParagraphs, chunkParagraphSegments } = await import('./provider-html')
const { TranslationProviderError } = await import('./azure')

const count = (s: string) => Array.from(s).length
const sentTotal = () => requests.flat().reduce((sum, text) => sum + count(text), 0)
const paragraphText = (p: { text: string }[]) => p.map((s) => s.text).join('')

/** A paragraph of exactly `size` characters made of real sentences. */
function prose(size: number, tag = '') {
  const sentence = 'The quiet harbour woke slowly as the gulls returned. '
  const text = (tag + sentence.repeat(Math.ceil(size / sentence.length) + 1)).slice(0, size)
  return text.trim().length === text.length ? text : text.slice(0, -1) + 'x'
}
function paragraphs(n: number, size: number) {
  return Array.from({ length: n }, (_, i) => prose(size, `P${i} `))
}
function bodyField(parts: string[]) {
  return { body: { kind: 'body' as const, body: parts.join('\n\n') } }
}
function expectBatchesWithinLimits() {
  for (const batch of requests) {
    expect(batch.length).toBeLessThanOrEqual(1_000)
    expect(batch.reduce((sum, text) => sum + count(text), 0)).toBeLessThanOrEqual(50_000)
  }
}

describe('batching boundaries', () => {
  it('exactly 50,000 characters: one request', async () => {
    const result = await translatePrivateFields({ fields: bodyField([prose(50_000)]), targetLanguage: 'es' })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toHaveLength(1)
    expect(db.reservations).toEqual([50_000])
    expect(result.reservedCharacters).toBe(50_000)

    requests = []
    db.reservations = []
    await translatePrivateFields({ fields: bodyField([prose(25_000), prose(25_000)]), targetLanguage: 'es' })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toHaveLength(2)
  })

  it('more than 50,000 characters: several requests, ordinary paragraphs kept whole', async () => {
    const parts = [prose(30_000, 'A '), prose(30_000, 'B ')]
    const result = await translatePrivateFields({ fields: bodyField(parts), targetLanguage: 'es' })
    expect(requests).toEqual([[parts[0]], [parts[1]]])
    expect(db.reservations).toEqual([60_000])
    if (result.fields.body.kind !== 'body') throw new Error('body')
    expect(result.fields.body.paragraphs.map(paragraphText)).toEqual(parts.map(fakeTranslate))
  })

  it('~120,000 characters: 3 ordered requests, 12 whole paragraphs, output in source order', async () => {
    const parts = paragraphs(12, 10_000)
    const result = await translatePrivateFields({ fields: bodyField(parts), targetLanguage: 'es' })
    expect(requests.map((r) => r.length)).toEqual([5, 5, 2])
    expect(requests.flat()).toEqual(parts) // each paragraph sent intact, in order
    expectBatchesWithinLimits()
    if (result.fields.body.kind !== 'body') throw new Error('body')
    expect(result.fields.body.paragraphs.map(paragraphText)).toEqual(parts.map(fakeTranslate))
  })

  it('~200,000 characters: one reservation for the exact total, then sequential batches', async () => {
    const parts = paragraphs(20, 10_000)
    const order: string[] = []
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      order.push(`start ${requests.length + 1}`)
      const response = await realFetch(url, init)
      order.push(`end ${requests.length}`)
      return response
    })
    const result = await translatePrivateFields({ fields: bodyField(parts), targetLanguage: 'es' })
    expect(db.reservations).toEqual([200_000])
    expect(sentTotal()).toBe(200_000)
    expect(result.reservedCharacters).toBe(200_000)
    expect(requests).toHaveLength(4)
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3', 'start 4', 'end 4'])
    // The reservation happened before the first request.
    expect(db.calls.findIndex((c) => c.kind === 'rpc')).toBe(0)
  })

  it('more than 1,000 provider elements: batched, not rejected', async () => {
    const parts = Array.from({ length: 1_500 }, (_, i) => `line ${i}`)
    const result = await translatePrivateFields({ fields: bodyField(parts), targetLanguage: 'es' })
    expect(requests.map((r) => r.length)).toEqual([1_000, 500])
    if (result.fields.body.kind !== 'body') throw new Error('body')
    expect(result.fields.body.paragraphs).toHaveLength(1_500)
    expect(paragraphText(result.fields.body.paragraphs[1_234])).toBe('LINE 1234')
  })

  it('several fields whose combined size exceeds 50,000 map back to the right fields', async () => {
    const title = 'A long letter home'
    const parts = [prose(20_000, 'first '), prose(20_000, 'second ')]
    const reveal = prose(15_000, 'reveal ')
    const result = await translatePrivateFields({
      fields: { title: { kind: 'text', text: title }, ...bodyField(parts), reveal_line: { kind: 'text', text: reveal } },
      targetLanguage: 'es',
    })
    expect(requests).toEqual([[title, parts[0], parts[1]], [reveal]])
    expect(result.fields.title).toEqual({ kind: 'text', text: fakeTranslate(title) })
    expect(result.fields.reveal_line).toEqual({ kind: 'text', text: fakeTranslate(reveal) })
    if (result.fields.body.kind !== 'body') throw new Error('body')
    expect(result.fields.body.paragraphs.map(paragraphText)).toEqual(parts.map(fakeTranslate))
    expect(db.reservations).toEqual([sentTotal()])
  })
})

describe('one paragraph larger than one request', () => {
  it('is split into valid units and reassembled into ONE canonical paragraph', async () => {
    const big = prose(120_000)
    const parts = ['Before.', big, 'After.']
    const result = await translatePrivateFields({ fields: bodyField(parts), targetLanguage: 'es' })
    expectBatchesWithinLimits()
    expect(requests.flat().length).toBeGreaterThan(3)
    if (result.fields.body.kind !== 'body') throw new Error('body')
    expect(result.fields.body.paragraphs).toHaveLength(3) // Moments/progress indexes unchanged
    expect(paragraphText(result.fields.body.paragraphs[1])).toBe(fakeTranslate(big))
    expect(paragraphText(result.fields.body.paragraphs[2])).toBe('AFTER.')
    // Split between whole sentences, never mid-word.
    const bigChunks = requests.flat().slice(1, -1)
    expect(bigChunks.join('')).toBe(big)
    for (const text of bigChunks) expect(text).toMatch(/^The quiet harbour /)
  })

  it('costs are measured on escaped HTML: markup-heavy text still fits each request', () => {
    const segments = [{ text: '&<>'.repeat(20_000), bold: true, italic: false }]
    const chunks = chunkParagraphSegments(segments)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(count(chunk.html)).toBeLessThanOrEqual(50_000)
      expect(chunk.html.startsWith('<strong>') && chunk.html.endsWith('</strong>')).toBe(true)
      expect(chunk.html).not.toMatch(/&(?!amp;|lt;|gt;)/) // never a cut entity
    }
  })

  it('formatting spanning chunks keeps bold/italic state and hard breaks', async () => {
    const boldRun = prose(70_000)
    const body = `${RICH_BODY_MARKER}Intro _soft_ words. **${boldRun}**\nLast line.`
    const result = await translatePrivateFields({ fields: { body: { kind: 'body', body } }, targetLanguage: 'es' })
    for (const text of requests.flat()) {
      expect((text.match(/<strong>/g) ?? []).length).toBe((text.match(/<\/strong>/g) ?? []).length)
      expect(text).not.toMatch(/<[^>]*$|^[^<]*>/) // never a cut tag
    }
    expect(requests.flat().filter((t) => t.includes('<strong>')).length).toBeGreaterThanOrEqual(2)
    if (result.fields.body.kind !== 'body') throw new Error('body')
    expect(result.fields.body.paragraphs).toHaveLength(1)
    expect(result.fields.body.paragraphs[0]).toEqual([
      { text: 'INTRO ', bold: false, italic: false },
      { text: 'SOFT', bold: false, italic: true },
      { text: ' WORDS. ', bold: false, italic: false },
      { text: fakeTranslate(boldRun), bold: true, italic: false },
      { text: '\nLAST LINE.', bold: false, italic: false },
    ])
  })

  it('Unicode near a boundary: no broken surrogate, combining mark or ZWJ sequence', async () => {
    const unit = '𠜎й👩‍👩‍👧漢字' // astral, combining, ZWJ emoji, CJK — no spaces anywhere
    const big = unit.repeat(Math.ceil(60_000 / count(unit)))
    const result = await translatePrivateFields({ fields: bodyField([big]), targetLanguage: 'es' })
    expect(requests.flat().length).toBeGreaterThan(1)
    for (const text of requests.flat()) {
      expect(text.isWellFormed()).toBe(true)
      expect(text).not.toMatch(/^[̆‍]/u)
      expect(text).not.toMatch(/‍$/u)
      expect(count(text)).toBeLessThanOrEqual(50_000)
    }
    if (result.fields.body.kind !== 'body') throw new Error('body')
    // Scripts without spaces get no spaces added at the seam.
    expect(paragraphText(result.fields.body.paragraphs[0])).toBe(big)
  })

  it('chunking is a no-op for any paragraph that fits', () => {
    const segments = [{ text: prose(49_000), bold: false, italic: false }]
    expect(chunkParagraphSegments(segments)).toHaveLength(1)
  })
})

describe('quota and failure semantics', () => {
  it('no Azure call when the whole operation exceeds the remaining allowance', async () => {
    db.allow = false
    await expect(
      translatePrivateFields({ fields: bodyField(paragraphs(12, 10_000)), targetLanguage: 'es' })
    ).rejects.toBeInstanceOf(TranslationBudgetExceededError)
    expect(db.reservations).toEqual([120_000])
    expect(requests).toEqual([])
  })

  it('a failed batch 2 fails the operation: no partial result, no cache writes, reservation kept', async () => {
    failOnRequest = 2
    await expect(
      translatePublicFields({
        fields: bodyField(paragraphs(12, 10_000)),
        targetLanguage: 'es',
        cache: { contentType: 'dispatch', contentId: 'd-big', contentVersion: 'r1' },
      })
    ).rejects.toBeInstanceOf(TranslationProviderError)
    expect(requests).toHaveLength(2) // batch 3 never sent
    expect(db.reservations).toEqual([120_000])
    expect(db.calls.some((c) => c.name === 'translation_cache:upsert')).toBe(false)
    expect(db.cache).toEqual([])
  })

  it('a later batch failing (batch 4 of 4) also writes nothing', async () => {
    failOnRequest = 4
    await expect(
      translatePublicFields({
        fields: { title: { kind: 'text', text: 'Title' }, ...bodyField(paragraphs(20, 10_000)) },
        targetLanguage: 'fr',
        cache: { contentType: 'dispatch', contentId: 'd-big', contentVersion: 'r1' },
      })
    ).rejects.toThrow()
    expect(db.cache).toEqual([])
  })

  it('private large translation never touches translation_cache', async () => {
    await translatePrivateFields({ fields: bodyField(paragraphs(12, 10_000)), targetLanguage: 'es' })
    expect(db.calls.filter((c) => c.kind === 'from')).toEqual([])
  })
})

describe('public cache with batching', () => {
  const cache = { contentType: 'dispatch', contentId: 'd-big', contentVersion: 'r1' }
  const fields = { title: { kind: 'text' as const, text: 'Harbour' }, ...bodyField(paragraphs(12, 10_000)) }

  it('a fully cached large operation reserves zero characters and makes zero Azure calls', async () => {
    await translatePublicFields({ fields, targetLanguage: 'es', cache })
    requests = []
    db.reservations = []
    const again = await translatePublicFields({ fields, targetLanguage: 'es', cache })
    expect(requests).toEqual([])
    expect(db.reservations).toEqual([])
    expect(again.reservedCharacters).toBe(0)
    expect(again.cachedFields.sort()).toEqual(['body', 'title'])
  })

  it('rows are written once, after all batches, one per field; batching does not change cache identity', async () => {
    await translatePublicFields({ fields, targetLanguage: 'es', cache })
    const upserts = db.calls.filter((c) => c.name === 'translation_cache:upsert')
    expect(upserts).toHaveLength(1)
    const rows = upserts[0].args as CacheRow[]
    expect(rows.map((r) => r.field_name)).toEqual(['title', 'body'])
    const canonical = bodyToProviderParagraphs(fields.body.body)
    const expected = createHash('sha256').update(JSON.stringify(['tempa-fields-1', 'body', canonical]), 'utf8').digest('hex')
    expect(rows[1].source_fingerprint).toBe(expected)
    expect(rows[1].source_character_count).toBe(120_000)
  })

  it('only genuine misses are batched', async () => {
    await translatePublicFields({ fields, targetLanguage: 'es', cache })
    requests = []
    await translatePublicFields({ fields: { ...fields, title: { kind: 'text', text: 'Harbor' } }, targetLanguage: 'es', cache })
    expect(requests).toEqual([['Harbor']])
  })
})

describe('partitionProviderBatches', () => {
  it('keeps order and both limits', () => {
    expect(partitionProviderBatches(['aa', 'bb', 'cc'], 4, 10)).toEqual([['aa', 'bb'], ['cc']])
    expect(partitionProviderBatches(['a', 'b', 'c'], 100, 2)).toEqual([['a', 'b'], ['c']])
    expect(partitionProviderBatches([], 4, 2)).toEqual([])
  })
})
