import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RICH_BODY_MARKER } from '@/lib/letter-editor-doc'

// ------------------------------------------------------------
// A recording fake service-role client (quota RPC + translation_cache)
// and a fake Azure HTTP endpoint behind the REAL adapter, so these tests
// see the exact bytes Tempa would send and the exact quota it reserves.
// ------------------------------------------------------------
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
      let fieldNames: string[] | null = null
      const query = {
        select: () => query,
        match: (m: Record<string, unknown>) => {
          Object.assign(filters, m)
          return query
        },
        in: (column: string, values: string[]) => {
          if (column === 'field_name') fieldNames = values
          return query
        },
        then: (resolve: (value: unknown) => void) =>
          resolve({
            data: db.cache.filter(
              (row) =>
                Object.entries(filters).every(([k, v]) => row[k] === v) &&
                (!fieldNames || fieldNames.includes(String(row.field_name)))
            ),
            error: null,
          }),
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

type SentRequest = { url: URL; items: Array<{ Text: string }>; headers: Record<string, string> }
let sent: SentRequest[] = []
// Fake Azure: "translates" by upper-casing text nodes only, keeping tags —
// enough to prove structure survives and the output is re-sanitized.
function fakeTranslate(html: string) {
  return html.replace(/<[^>]*>|&[a-z]+;|[a-z]+/gi, (m) => (m.startsWith('<') || m.startsWith('&') ? m : m.toUpperCase()))
}

beforeEach(() => {
  db.calls = []
  db.reservations = []
  db.cache = []
  db.allow = true
  sent = []
  process.env.AZURE_TRANSLATOR_KEY = 'test-key'
  process.env.AZURE_TRANSLATOR_ENDPOINT = 'https://translator.test'
  process.env.TRANSLATION_MONTHLY_CHARACTER_LIMIT = '1800000'
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const items = JSON.parse(String(init.body)) as Array<{ Text: string }>
    sent.push({ url: new URL(url), items, headers: init.headers as Record<string, string> })
    return new Response(
      JSON.stringify(
        items.map((item) => ({ detectedLanguage: { language: 'ja', score: 1 }, translations: [{ text: fakeTranslate(item.Text), to: 'es' }] }))
      ),
      { status: 200 }
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const {
  translatePrivateFields,
  translatePublicFields,
  translatePrivateText,
  UnsupportedTranslationLanguageError,
  FIELD_TRANSLATION_PROVIDER_VERSION,
} = await import('./service')

const richBody = `${RICH_BODY_MARKER}Hello **there**, _friend_.\nSecond line.\n\nA <script>x</script> & more.`
const letterFields = {
  body: { kind: 'body' as const, body: richBody },
  reveal_line: { kind: 'text' as const, text: 'See you soon' },
  back_message: { kind: 'text' as const, text: '' },
}

const count = (s: string) => Array.from(s).length

describe('field translation — exact outbound accounting', () => {
  it('reserves exactly the characters of the strings sent (markup included), one request, textType=html', async () => {
    const result = await translatePrivateFields({ fields: letterFields, targetLanguage: 'es' })

    expect(sent).toHaveLength(1)
    expect(sent[0].url.searchParams.get('textType')).toBe('html')
    expect(sent[0].url.searchParams.get('to')).toBe('es')
    const sentCharacters = sent[0].items.reduce((sum, item) => sum + count(item.Text), 0)
    expect(db.reservations).toEqual([sentCharacters])
    expect(result.reservedCharacters).toBe(sentCharacters)
    expect(sent[0].items.map((i) => i.Text)).toEqual([
      'Hello <strong>there</strong>, <em>friend</em>.<br>Second line.',
      'A &lt;script&gt;x&lt;/script&gt; &amp; more.',
      'See you soon',
    ])
  })

  it('maps results back by field and by canonical paragraph, sanitized', async () => {
    const result = await translatePrivateFields({ fields: letterFields, targetLanguage: 'es' })
    expect(result.fields.body).toEqual({
      kind: 'body',
      paragraphs: [
        [
          { text: 'HELLO ', bold: false, italic: false },
          { text: 'THERE', bold: true, italic: false },
          { text: ', ', bold: false, italic: false },
          { text: 'FRIEND', bold: false, italic: true },
          { text: '.\nSECOND LINE.', bold: false, italic: false },
        ],
        [{ text: 'A <SCRIPT>X</SCRIPT> & MORE.', bold: false, italic: false }],
      ],
    })
    expect(result.fields.reveal_line).toEqual({ kind: 'text', text: 'SEE YOU SOON' })
    expect(result.fields.back_message).toEqual({ kind: 'text', text: '' })
    expect(result.sourceLanguage).toBe('ja')
    expect(result.provider).toBe('azure')
  })
})

describe('field translation — validation happens before any spend', () => {
  it('unknown/unsupported target (or source) languages are rejected before quota or Azure', async () => {
    for (const targetLanguage of ['xx', 'tlh-Latn', '', 'es;drop']) {
      await expect(translatePrivateFields({ fields: letterFields, targetLanguage })).rejects.toBeInstanceOf(
        UnsupportedTranslationLanguageError
      )
    }
    await expect(
      translatePublicFields({
        fields: letterFields,
        targetLanguage: 'es',
        sourceLanguage: 'klingon',
        cache: { contentType: 'dispatch', contentId: 'd1', contentVersion: 'v1' },
      })
    ).rejects.toBeInstanceOf(UnsupportedTranslationLanguageError)
    expect(db.calls).toEqual([])
    expect(sent).toEqual([])
  })

  it('same source and target: no provider call, no reservation', async () => {
    const result = await translatePrivateFields({ fields: letterFields, targetLanguage: 'es', sourceLanguage: 'es' })
    expect(result.provider).toBe('none')
    expect(db.calls).toEqual([])
    expect(sent).toEqual([])
    expect(result.fields.reveal_line).toEqual({ kind: 'text', text: 'See you soon' })
  })
})

describe('PRIVATE fields never touch translation_cache', () => {
  it('no cache read or write, nothing persisted', async () => {
    await translatePrivateFields({ fields: letterFields, targetLanguage: 'fr' })
    expect(db.calls.filter((c) => c.kind === 'from')).toEqual([])
    expect(db.cache).toEqual([])
    expect(db.calls.map((c) => c.name)).toEqual(['reserve_translation_characters'])
  })
})

describe('PUBLIC fields cache field-by-field', () => {
  const cache = { contentType: 'dispatch', contentId: 'd-1', contentVersion: 'rev-1' }
  const dispatchFields = {
    title: { kind: 'text' as const, text: 'A quiet morning' },
    body: { kind: 'body' as const, body: 'Paragraph one.\n\nParagraph two.' },
  }

  it('first read translates misses and stores one sanitized row per field', async () => {
    const result = await translatePublicFields({ fields: dispatchFields, targetLanguage: 'es', cache })
    expect(result.cachedFields).toEqual([])
    expect(sent).toHaveLength(1)
    const upserts = db.calls.filter((c) => c.name === 'translation_cache:upsert')
    expect(upserts).toHaveLength(1)
    const rows = upserts[0].args as CacheRow[]
    expect(rows.map((r) => r.field_name)).toEqual(['title', 'body'])
    for (const row of rows) {
      expect(row.provider_version).toBe(FIELD_TRANSLATION_PROVIDER_VERSION)
      expect(row.source_fingerprint).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(row)).not.toContain('Paragraph one') // source text is never stored
    }
  })

  it('a cache hit invokes no Azure call and reserves zero characters', async () => {
    await translatePublicFields({ fields: dispatchFields, targetLanguage: 'es', cache })
    const first = db.reservations.length
    sent = []
    const again = await translatePublicFields({ fields: dispatchFields, targetLanguage: 'es', cache })
    expect(sent).toEqual([])
    expect(db.reservations).toHaveLength(first)
    expect(again.reservedCharacters).toBe(0)
    expect(again.cachedFields.sort()).toEqual(['body', 'title'])
    expect(again.fields.title).toEqual({ kind: 'text', text: 'A QUIET MORNING' })
  })

  it('only misses are sent: a changed title re-translates the title alone', async () => {
    await translatePublicFields({ fields: dispatchFields, targetLanguage: 'es', cache })
    sent = []
    const edited = { ...dispatchFields, title: { kind: 'text' as const, text: 'A loud morning' } }
    const result = await translatePublicFields({ fields: edited, targetLanguage: 'es', cache })
    expect(sent[0].items.map((i) => i.Text)).toEqual(['A loud morning'])
    expect(result.cachedFields).toEqual(['body'])
  })

  it('a formatting-only change is a different fingerprint, never an old translation', async () => {
    await translatePublicFields({ fields: dispatchFields, targetLanguage: 'es', cache })
    sent = []
    const bolded = { ...dispatchFields, body: { kind: 'body' as const, body: `${RICH_BODY_MARKER}Paragraph **one**.\n\nParagraph two.` } }
    const result = await translatePublicFields({ fields: bolded, targetLanguage: 'es', cache })
    expect(sent).toHaveLength(1)
    expect(result.cachedFields).toEqual(['title'])
  })

  it('a different language is a separate cache entry', async () => {
    await translatePublicFields({ fields: dispatchFields, targetLanguage: 'es', cache })
    sent = []
    await translatePublicFields({ fields: dispatchFields, targetLanguage: 'fr', cache })
    expect(sent).toHaveLength(1)
    expect(new Set(db.cache.map((r) => r.target_language))).toEqual(new Set(['es', 'fr']))
  })

  it('a tampered/invalid cache row is treated as a miss, never rendered', async () => {
    await translatePublicFields({ fields: dispatchFields, targetLanguage: 'es', cache })
    for (const row of db.cache) row.translated_text = '<script>alert(1)</script>'
    sent = []
    const result = await translatePublicFields({ fields: dispatchFields, targetLanguage: 'es', cache })
    expect(sent).toHaveLength(1)
    expect(JSON.stringify(result.fields)).not.toContain('<script>')
  })
})

describe('existing v1 API stays compatible', () => {
  it('translatePrivateText sends one plain-text element with no textType and never touches the cache', async () => {
    const result = await translatePrivateText({ text: 'Tempa translation is connected and working.', sourceLanguage: 'en', targetLanguage: 'es' })
    expect(sent).toHaveLength(1)
    expect(sent[0].url.searchParams.has('textType')).toBe(false)
    expect(sent[0].items).toEqual([{ Text: 'Tempa translation is connected and working.' }])
    expect(db.reservations).toEqual([43])
    expect(db.calls.filter((c) => c.kind === 'from')).toEqual([])
    expect(result).toMatchObject({ provider: 'azure', cached: false, sourceCharacterCount: 43 })
  })
})
