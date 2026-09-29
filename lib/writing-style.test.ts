import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  TEMPA_PROSE_TYPOGRAPHY,
  WRITING_STYLES,
  WRITING_STYLE_IDS,
  WRITING_STYLE_LIST,
  WRITING_STYLE_FALLBACK_SAMPLE,
  READER_VIEW_MIN_CHARS,
  beginsTypographically,
  composeProse,
  isSalutation,
  isSignOff,
  normalizeWritingStyleId,
  offersReaderView,
  previewExcerpt,
  proseTypographyVars,
  resolveProseTypography,
  WRITING_STYLE_HEADING,
  WRITING_STYLE_INTRO,
} from './writing-style'

describe('Writing Style registry — six semantic styles, one source of truth', () => {
  it('has exactly the six launch ids, in order, with descriptive names and the specified faces', () => {
    expect(WRITING_STYLE_IDS).toEqual(['ink', 'notebook', 'freehand', 'literary', 'correspondence', 'typewriter'])
    expect(WRITING_STYLE_LIST.map((s) => [s.id, s.name, s.face])).toEqual([
      ['ink', 'Ink', 'Kalam'],
      ['notebook', 'Notebook', 'Patrick Hand'],
      ['freehand', 'Freehand', 'Caveat'],
      ['literary', 'Literary', 'Lora'],
      ['correspondence', 'Correspondence', 'EB Garamond'],
      ['typewriter', 'Typewriter', 'Courier Prime'],
    ])
  })

  it('never names a style after a personality', () => {
    const names = WRITING_STYLE_LIST.map((s) => s.name.toLowerCase()).join(' ')
    for (const word of ['romantic', 'intellectual', 'rebel', 'dreamer', 'old soul', 'artist']) {
      expect(names).not.toContain(word)
    }
  })

  it('the stored id is never the font name', () => {
    for (const style of WRITING_STYLE_LIST) {
      expect(style.id).not.toBe(style.face.toLowerCase())
      expect(style.id).toMatch(/^[a-z]+$/)
    }
  })

  it('each style is its own typography system, not one recipe with six families', () => {
    const recipes = new Set(
      WRITING_STYLE_LIST.map((s) => JSON.stringify([s.size, s.lineHeight, s.measure, s.paragraphGap]))
    )
    expect(recipes.size).toBe(6)
    for (const style of WRITING_STYLE_LIST) {
      expect(style.size.sm).toBeGreaterThanOrEqual(15)
      expect(style.lineHeight.sm).toBeGreaterThanOrEqual(1.35)
      expect(style.measure).toBeGreaterThanOrEqual(55)
      expect(style.measure).toBeLessThanOrEqual(72)
    }
    // Caveat's small x-height needs a larger set size; Courier's wide
    // monospace a smaller one.
    expect(WRITING_STYLES.freehand.size.lg).toBeGreaterThan(WRITING_STYLES.literary.size.lg)
    expect(WRITING_STYLES.typewriter.size.lg).toBeLessThan(WRITING_STYLES.literary.size.lg)
  })

  it('opening treatments differ by style: drop caps only for the book serifs, none for Typewriter', () => {
    expect(WRITING_STYLES.literary.opening.kind).toBe('dropcap')
    expect(WRITING_STYLES.correspondence.opening.kind).toBe('dropcap')
    for (const id of ['ink', 'notebook', 'freehand'] as const) expect(WRITING_STYLES[id].opening.kind).toBe('initial')
    expect(WRITING_STYLES.typewriter.opening.kind).toBe('none')
    expect(WRITING_STYLES.literary.opening.lines).toBeGreaterThanOrEqual(2)
    expect(WRITING_STYLES.correspondence.opening.lines).toBeLessThanOrEqual(3)
    // Phones get a shorter initial: never taller than the wide-screen one.
    expect(WRITING_STYLES.correspondence.opening.linesSm).toBe(2)
    expect(proseTypographyVars(WRITING_STYLES.correspondence)['--wp-open-lines-sm']).toBe('2')
    expect(proseTypographyVars(WRITING_STYLES.literary)['--wp-open-lines-sm']).toBe('2')
    // Handwriting initials stay restrained — never a greeting-card flourish.
    for (const id of ['ink', 'notebook', 'freehand'] as const) expect(WRITING_STYLES[id].opening.size).toBeLessThanOrEqual(1.6)
  })

  it('every face ends in a generic family, so missing glyphs always render legibly', () => {
    for (const style of WRITING_STYLE_LIST) expect(style.fallback).toMatch(/(serif|monospace)$/)
    for (const id of ['ink', 'notebook', 'freehand', 'literary', 'correspondence'] as const) {
      expect(WRITING_STYLES[id].fallback).toContain('var(--font-newsreader)')
    }
  })

  it('Typewriter stays monospaced for scripts Courier Prime lacks, starting with metric-compatible Courier New', () => {
    const stack = WRITING_STYLES.typewriter.fallback
    expect(stack.startsWith("'Courier New'")).toBe(true)
    expect(stack.endsWith('monospace')).toBe(true)
    expect(stack).not.toMatch(/Arial|sans-serif|var(--font-newsreader)/)
  })

  it('Typewriter references Courier Prime without next/font’s Arial fallback face; the other faces keep theirs', () => {
    expect(WRITING_STYLES.typewriter.familyVar).toBe('--font-courier-prime-face')
    for (const id of ['ink', 'notebook', 'freehand', 'literary', 'correspondence'] as const) {
      expect(WRITING_STYLES[id].familyVar).not.toMatch(/-face$/)
    }
    const fonts = readFileSync(path.join(__dirname, '..', 'app', 'writing-style-fonts.ts'), 'utf8')
    expect(fonts).toContain("'--font-courier-prime-face': primaryFontFamily(courierPrime.style.fontFamily)")
    expect(readFileSync(path.join(__dirname, '..', 'app', 'layout.tsx'), 'utf8')).toContain('style={writingStyleFontFaceVars}')
  })
})

describe('safe fallbacks — nothing stored can become CSS', () => {
  it('normalizes null, unknown, wrong-type and hostile values to "no style"', () => {
    for (const bad of [null, undefined, '', 'Kalam', 'INK', 'ink ', 7, {}, 'ink; background:url(x)', "'); }"]) {
      expect(normalizeWritingStyleId(bad)).toBeNull()
    }
    for (const id of WRITING_STYLE_IDS) expect(normalizeWritingStyleId(id)).toBe(id)
  })

  it('null/invalid resolve to Tempa canonical prose; Reader view always does', () => {
    expect(resolveProseTypography(null)).toBe(TEMPA_PROSE_TYPOGRAPHY)
    expect(resolveProseTypography('nonsense')).toBe(TEMPA_PROSE_TYPOGRAPHY)
    expect(resolveProseTypography('ink')).toBe(WRITING_STYLES.ink)
    for (const id of WRITING_STYLE_IDS) expect(resolveProseTypography(id, 'reader')).toBe(TEMPA_PROSE_TYPOGRAPHY)
  })

  it('custom properties are produced only from the registry', () => {
    const vars = proseTypographyVars(resolveProseTypography('x; color:red'))
    expect(vars['--wp-family']).toBe(`var(--font-newsreader), ${TEMPA_PROSE_TYPOGRAPHY.fallback}`)
    expect(Object.values(vars).join(' ')).not.toContain('color:red')
    expect(proseTypographyVars(WRITING_STYLES.ink)['--wp-family']).toMatch(/^var\(--font-kalam\), /)
  })

  it('Tempa canonical prose matches the long-standing reading size (19px / 20px, leading-relaxed)', () => {
    expect(TEMPA_PROSE_TYPOGRAPHY.size).toEqual({ sm: 19, lg: 20 })
    expect(TEMPA_PROSE_TYPOGRAPHY.lineHeight.lg).toBe(1.625)
    expect(TEMPA_PROSE_TYPOGRAPHY.opening.kind).toBe('none')
  })
})

describe('composition — the real first prose paragraph', () => {
  it('a letter beginning "Dear Mia," keeps the greeting plain and opens on the next paragraph', () => {
    const { roles, openingIndex } = composeProse(['Dear Mia,', 'Your letter arrived on a Tuesday.', 'More.'])
    expect(roles[0]).toBe('salutation')
    expect(openingIndex).toBe(1)
    expect(roles[1]).toBe('opening')
  })

  it('recognizes common greetings but not prose that merely ends in a comma', () => {
    for (const s of ['Dear Mia,', 'Hi Sam —', 'Querida Ana:', 'Hello again!', 'Dearest Tomás,']) expect(isSalutation(s)).toBe(true)
    for (const s of ['It rained all week. Then,', 'Dear Mia,\nI hope this finds you well.', 'I have been thinking about what you said about trains and patience,'])
      expect(isSalutation(s)).toBe(false)
  })

  it('a single-paragraph piece is never treated as a salutation', () => {
    expect(composeProse(['Dear Mia,']).roles).toEqual(['opening'])
  })

  it('opening quotation marks and apostrophes are fine; emoji, dashes and brackets get no enlarged opening', () => {
    expect(beginsTypographically('“Why write them down?” a friend asked.')).toBe(true)
    expect(beginsTypographically('’Tis a strange thing.')).toBe(true)
    expect(beginsTypographically('1998 was the year.')).toBe(true)
    expect(beginsTypographically('Élodie wrote first.')).toBe(true)
    expect(beginsTypographically('🙂 Hello there')).toBe(false)
    expect(beginsTypographically('— and then')).toBe(false)
    expect(beginsTypographically('(an aside)')).toBe(false)
    expect(composeProse(['🙂 Hello there', 'Second.']).openingIndex).toBeNull()
  })

  it('rich markup is looked through, never mistaken for the opening character', () => {
    expect(beginsTypographically('**Bold** start', true)).toBe(true)
    expect(isSalutation('_Dear Mia,_', true)).toBe(true)
  })

  it('detects a structural sign-off only at the end of a longer letter', () => {
    expect(isSignOff('With warmth,\nTomás')).toBe(true)
    expect(isSignOff('Love, Maya')).toBe(true)
    expect(isSignOff('— Maya')).toBe(true)
    expect(isSignOff('I will write again soon, I promise, once the move is done.')).toBe(false)
    expect(composeProse(['Dear Mia,', 'Body.', 'With warmth,\nTomás']).roles).toEqual(['salutation', 'opening', 'signoff'])
    expect(composeProse(['Hello.', 'Love, Maya']).roles).toEqual(['opening', 'body'])
  })

  it('empty input is harmless', () => {
    expect(composeProse([])).toEqual({ roles: [], openingIndex: null })
  })
})

describe('preview excerpt — the member’s own words', () => {
  it('returns short text whole, and never cuts mid-word', () => {
    expect(previewExcerpt('A short answer.')).toBe('A short answer.')
    const long = 'word '.repeat(200)
    const out = previewExcerpt(long, 100)!
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/wor…$/)
    expect(Array.from(out).length).toBeLessThanOrEqual(101)
  })

  it('prefers a sentence boundary when one is available', () => {
    const text = `${'This is a sentence that goes on. '.repeat(10)}`
    expect(previewExcerpt(text, 120)!.endsWith('.')).toBe(true)
  })

  it('nothing usable → null (the caller then uses the restrained fallback)', () => {
    expect(previewExcerpt(null)).toBeNull()
    expect(previewExcerpt('   \n\n ')).toBeNull()
    expect(WRITING_STYLE_FALLBACK_SAMPLE).not.toMatch(/quick brown fox|lorem/i)
  })
})

describe('Reader view is offered only on substantial styled writing', () => {
  it('needs a real style and enough length', () => {
    const long = 'x'.repeat(READER_VIEW_MIN_CHARS)
    expect(offersReaderView('ink', long)).toBe(true)
    expect(offersReaderView('ink', 'short')).toBe(false)
    expect(offersReaderView(null, long)).toBe(false)
    expect(offersReaderView('bogus', long)).toBe(false)
  })
})

describe('one restrained experience for everyone', () => {
  it('uses the same heading and supporting line for new and existing members', () => {
    expect(WRITING_STYLE_HEADING).toBe('Give your words a shape.')
    expect(WRITING_STYLE_INTRO).toBe('Choose how your writing appears when it reaches someone.')
  })
})
