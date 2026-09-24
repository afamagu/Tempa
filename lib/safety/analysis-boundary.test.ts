import { describe, it, expect } from 'vitest'
import { analyzeText } from './analysis-boundary'
import { classifyContent } from './classify'

describe('analysis boundary — original text always analysed; translation is optional and never "safe by default"', () => {
  const ASK = 'I have an urgent need for funds. Please help me.'

  it('with no translation requested (Phase 1) it is exactly the classifier on the original text', () => {
    const result = analyzeText(ASK)
    expect(result.classification).toEqual(classifyContent(ASK))
    expect(result.coverage).toEqual({ original: 'analyzed', translation: 'not_requested' })
  })

  it('"translation unavailable" leaves the original analysis untouched and is reported, never treated as an all-clear', () => {
    const result = analyzeText(ASK, { translation: { status: 'unavailable' } })
    expect(result.classification.mutationDisposition).toBe('deny')
    expect(result.coverage.translation).toBe('unavailable')
    const benign = analyzeText('Tell me about your day.', { translation: { status: 'unavailable' } })
    expect(benign.coverage.translation).toBe('unavailable')
  })

  it('an available translated representation can only add concern: the most restrictive result wins', () => {
    const result = analyzeText('Hola, ¿cómo estás?', { translation: { status: 'available', text: ASK } })
    expect(result.classification.mutationDisposition).toBe('deny')
    expect(result.coverage.translation).toBe('analyzed')
    const original = analyzeText(ASK, { translation: { status: 'available', text: 'Hello, how are you?' } })
    expect(original.classification.mutationDisposition).toBe('deny')
  })

  it('threads the private-letter option through to both representations', () => {
    const result = analyzeText('Nice to meet you.', { privateLetter: true, translation: { status: 'available', text: 'Message me on WhatsApp.' } })
    expect(result.classification.reasonCodes).toContain('PERSONAL_CONTACT_SHARING')
  })
})
