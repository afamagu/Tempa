import { describe, it, expect } from 'vitest'
import { toDisplayText, toCanonicalText, toNumericText } from './normalize'

describe('toDisplayText', () => {
  it('strips zero-width characters used to break up a word', () => {
    expect(toDisplayText('m​o‌n‍ey')).toBe('money')
  })

  it('applies Unicode NFKC (full-width characters fold to ASCII)', () => {
    expect(toDisplayText('ｍｏｎｅｙ')).toBe('money')
  })

  it('leaves ordinary text untouched', () => {
    expect(toDisplayText('Food is expensive here.')).toBe('Food is expensive here.')
  })
})

describe('toCanonicalText', () => {
  it('folds common Cyrillic homoglyphs to their Latin lookalikes', () => {
    // Cyrillic а (U+0430), е (U+0435), о (U+043E)
    expect(toCanonicalText('mоney')).toBe('money')
    expect(toCanonicalText('sеnd')).toBe('send')
  })

  it('de-leets common digit/symbol-for-letter substitutions', () => {
    expect(toCanonicalText('m0ney')).toBe('money')
    expect(toCanonicalText('@ccount')).toBe('account')
    expect(toCanonicalText('c4sh')).toBe('cash')
  })

  it('collapses punctuation-separated letter-spacing evasion, without bridging across the space between words', () => {
    expect(toCanonicalText('s.e.n.d m.o.n.e.y')).toBe('send money')
    expect(toCanonicalText('s-e-n-d m-o-n-e-y')).toBe('send money')
  })

  it('collapses short but important 3-letter spaced keywords ("buy", "pay")', () => {
    expect(toCanonicalText('b.u.y')).toBe('buy')
    expect(toCanonicalText('p-a-y')).toBe('pay')
  })

  it('requires at least a 3-character run — a 2-letter hyphenated token is left alone, since it is genuinely ambiguous with a real abbreviation', () => {
    expect(toCanonicalText('m-e')).toBe('m-e')
  })

  it('does not mangle ordinary short text or abbreviations', () => {
    expect(toCanonicalText('U.S.')).toBe('u.s.')
    expect(toCanonicalText('Dr. Smith')).toBe('dr. smith')
  })

  it('lowercases the result', () => {
    expect(toCanonicalText('SEND ME MONEY')).toBe('send me money')
  })
})

describe('toNumericText', () => {
  it('collapses spaced-out digit runs into a plain number', () => {
    expect(toNumericText('$ 3 0 0')).toBe('$300')
  })

  it('folds a letter O standing in for a digit zero within a numeric token', () => {
    expect(toNumericText('3OO dollars')).toBe('300 dollars')
    expect(toNumericText('1O,OOO')).toBe('10,000')
  })

  it('never touches ordinary words with no digits', () => {
    expect(toNumericText('too cool')).toBe('too cool')
  })

  it('does not fight toCanonicalText — letters are never converted to digits by this function', () => {
    // Only O -> 0 in an already-numeric context; a bare word is untouched.
    expect(toNumericText('cool')).toBe('cool')
  })
})
