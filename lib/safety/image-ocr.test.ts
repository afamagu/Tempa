import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { extractImageSafetyText, classifyImageText } from './image-ocr'
import { combineClassifications, classifyContent } from './classify'

describe('extractImageSafetyText — the one OCR adapter, currently always unavailable', () => {
  it('always resolves unavailable — no real extraction runs yet, never invented text_found/no_text', async () => {
    const result = await extractImageSafetyText({ path: 'author/some-image.jpg' })
    expect(result).toEqual({ status: 'unavailable', reason: 'ocr_not_implemented' })
  })

  it('accepts a Blob just as readily as a stable-path descriptor — same adapter shape either way', async () => {
    const result = await extractImageSafetyText(new Blob(['fake image bytes']))
    expect(result.status).toBe('unavailable')
  })

  it('never calls fetch/an external AI endpoint — inspected directly from source, since the function body never runs any I/O today', () => {
    const source = readFileSync(path.join(__dirname, 'image-ocr.ts'), 'utf8')
    const adapterStart = source.indexOf('export async function extractImageSafetyText')
    const adapterEnd = source.indexOf('\n}', adapterStart)
    const adapterBody = source.slice(adapterStart, adapterEnd)
    for (const forbidden of ['fetch(', 'openai', 'anthropic', 'gemini', 'googleapis', 'XMLHttpRequest']) {
      expect(adapterBody.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('this whole module never writes to any table/log/analytics sink — no Supabase client, no console/log call, no persistence path at all for extracted text', () => {
    const source = readFileSync(path.join(__dirname, 'image-ocr.ts'), 'utf8')
    for (const forbidden of ['createClient', '.insert(', '.upsert(', '.from(', 'console.', '.rpc(']) {
      expect(source).not.toContain(forbidden)
    }
  })
})

describe('classifyImageText — reuses classifyContent, never a second classifier, remaps to the reserved image reason codes', () => {
  it('image contained no readable text → classifying an empty/whitespace string produces no financial signal', () => {
    const result = classifyImageText('   ')
    expect(result).toEqual({ riskBand: 'none', reasonCodes: [], mutationDisposition: 'allow', escalateCase: false })
  })

  it('benign image text (a menu / a price) never escalates', () => {
    for (const text of ['Pasta - $12', 'Coffee menu: Latte $4, Espresso $3', 'Room rate: $150/night']) {
      const result = classifyImageText(text)
      expect(result.mutationDisposition).toBe('allow')
      expect(result.escalateCase).toBe(false)
      expect(result.reasonCodes).toEqual([])
    }
  })

  it('a direct money/gift-card request in image text produces IMAGE_TEXT_FINANCIAL_SIGNAL, not the underlying content code', () => {
    const result = classifyImageText('Buy a Steam gift card and send me the code.')
    expect(result.reasonCodes).toEqual(['IMAGE_TEXT_FINANCIAL_SIGNAL'])
    expect(result.reasonCodes).not.toContain('GIFT_CARD_REQUEST')
    expect(result.riskBand).toBe(classifyContent('Buy a Steam gift card and send me the code.').riskBand)
    expect(result.mutationDisposition).toBe(classifyContent('Buy a Steam gift card and send me the code.').mutationDisposition)
  })

  it('payment/account-detail image text produces IMAGE_TEXT_PAYMENT_DETAILS, preserving the classifier\'s own band/disposition/escalation exactly', () => {
    const rawText = 'Here is my IBAN: DE89370400440532013000'
    const raw = classifyContent(rawText)
    const result = classifyImageText(rawText)
    expect(result.reasonCodes).toEqual(['IMAGE_TEXT_PAYMENT_DETAILS'])
    expect(result.reasonCodes).not.toContain('PAYMENT_DETAILS')
    expect(result.riskBand).toBe(raw.riskBand)
    expect(result.mutationDisposition).toBe(raw.mutationDisposition)
    expect(result.escalateCase).toBe(raw.escalateCase)
  })

  it('both financial and payment signals in the same image text produce both reserved codes', () => {
    const result = classifyImageText('Buy a Steam gift card and send me the code. Here is my IBAN: DE89370400440532013000')
    expect(result.reasonCodes).toContain('IMAGE_TEXT_FINANCIAL_SIGNAL')
    expect(result.reasonCodes).toContain('IMAGE_TEXT_PAYMENT_DETAILS')
  })

  it('out-of-scope image-only signals (a bare link/phishing pattern, no financial ask) are dropped entirely — not general image-link moderation', () => {
    const result = classifyImageText('Check this out: http://bit.ly/xyz123')
    expect(result).toEqual({ riskBand: 'none', reasonCodes: [], mutationDisposition: 'allow', escalateCase: false })
  })

  it('never produces a behavioral reason code — those are account-level, never derivable from one image', () => {
    const result = classifyImageText('Buy a Steam gift card and send me the code.')
    for (const code of result.reasonCodes) {
      expect(code.startsWith('IMAGE_TEXT_')).toBe(true)
    }
  })
})

describe('combining image-text Safety with the written body (item 6) — augments, never replaces or downgrades', () => {
  it('a benign body + a financial-solicitation image combine to reflect the image signal', () => {
    const bodyResult = classifyContent('The weather has been lovely here.')
    const imageResult = classifyImageText('Buy a Steam gift card and send me the code.')
    const combined = combineClassifications([bodyResult, imageResult])
    expect(combined.reasonCodes).toContain('IMAGE_TEXT_FINANCIAL_SIGNAL')
    expect(combined.mutationDisposition).not.toBe('allow')
  })

  it('a warn/deny already produced by the written body is never downgraded by a clean image (no text found)', () => {
    const bodyResult = classifyContent('Buy a Steam gift card and send me the code.')
    const cleanImageResult = classifyImageText('')
    const combined = combineClassifications([bodyResult, cleanImageResult])
    expect(combined.riskBand).toBe(bodyResult.riskBand)
    expect(combined.mutationDisposition).toBe(bodyResult.mutationDisposition)
    expect(combined.reasonCodes).toEqual(expect.arrayContaining(bodyResult.reasonCodes))
  })

  it('an unavailable OCR result contributes nothing to the combined classification — never invented evidence, never a false accusation', () => {
    const bodyResult = classifyContent('Food is expensive here.')
    // The caller's own contract: an 'unavailable' ImageOcrResult is
    // never passed to classifyImageText at all (there is no text to
    // classify) — it simply contributes no ClassificationResult to the
    // combine call, exactly as if the Moment had no image-text check.
    const combined = combineClassifications([bodyResult])
    expect(combined.mutationDisposition).toBe('allow')
    expect(combined.reasonCodes).toEqual([])
  })
})
