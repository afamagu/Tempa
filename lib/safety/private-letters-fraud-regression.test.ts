import { describe, expect, it } from 'vitest'
import { classifyContent } from './classify'
import { analyzeText } from './analysis-boundary'

describe('Issue #131: private correspondence fraud vs intimate/adult conversation', () => {
  it.each([
    'I spent 1800 naira travelling to the Island market.',
    'I ordered two sewing machines from China and I need more money to expand.',
    'I had a difficult month and I am worried about rent.',
    'I talked about porn, masturbation, and cannabis in a letter.',
    'My boyfriend asked me about the champagne beads for Mrs Fatimah.',
    'I am saving for my business and my parents are proud of me.',
  ])('does not block an ordinary letter: %s', (body) => {
    expect(classifyContent(body).mutationDisposition).not.toBe('deny')
    expect(analyzeText(body).classification.mutationDisposition).not.toBe('deny')
  })
  it.each([
    'Please send me money for the customs clearance fee.',
    'Can you transfer $500 to my bank account?',
    'Please buy me a gift card and send the PIN.',
    'I need you to receive the funds and forward them to my agent.',
  ])('blocks direct financial solicitation: %s', (body) => {
    expect(classifyContent(body).mutationDisposition).toBe('deny')
  })
})
