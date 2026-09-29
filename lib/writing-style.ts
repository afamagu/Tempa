// Writing Style — the ONE source of truth for how a member's authored
// prose is typeset. (Member-facing copy never says "font": the member is
// choosing how their writing appears, not configuring software.)
//
// Persistence stores only the stable semantic ID (profiles.
// writing_style_id, letters/dispatches.author_writing_style_id — see
// docs/sql/2026-10-29-writing-style.sql). Everything visual — family,
// fallback stack, size, rhythm, measure, opening treatment — lives here,
// so a face can later be tuned or replaced without migrating a single
// row, and nothing stored in the database can ever become CSS: an
// unknown/invalid value resolves to null, and null resolves to Tempa's
// own canonical prose typography.
//
// The font files themselves are loaded once in app/writing-style-fonts.ts
// (next/font, self-hosted, preload: false); `familyVar` names the CSS
// variable that module defines.

export const WRITING_STYLE_IDS = ['ink', 'notebook', 'freehand', 'literary', 'correspondence', 'typewriter'] as const

export type WritingStyleId = (typeof WRITING_STYLE_IDS)[number]

/** How the first real prose paragraph begins.
 *  - dropcap: a floated initial spanning ~2–3 lines (book serifs only)
 *  - initial: an enlarged, inline first letter (handwriting faces)
 *  - none:    the face's ordinary opening rhythm (Typewriter)          */
export type OpeningKind = 'dropcap' | 'initial' | 'none'

export type ProseTypography = {
  /** CSS custom property set by app/writing-style-fonts.ts (or the root
   *  layout for Newsreader). */
  familyVar: string
  /** Appended after the face's own CSS variable. Glyph fallback, as the
   *  browser actually resolves it (app/writing-style-fonts.ts):
   *  - next/font emits every subset of a family (unicode-range), so any
   *    script the face itself covers renders in the face;
   *  - most faces' next/font variable also carries a metric-matched local
   *    fallback face with no unicode-range (Arial for the handwriting
   *    faces, Times New Roman for Lora/EB Garamond), which catches any
   *    other script that system face covers;
   *  - only then this stack, for scripts those system faces lack.
   *  Typewriter opts out of the Arial fallback so missing scripts stay
   *  monospaced (see its entry). Always legible; never tofu. */
  fallback: string
  /** Weights actually loaded for this face (bold markup uses the
   *  heaviest; a face with only 400 lets the browser synthesize). */
  weights: readonly number[]
  bodyWeight: number
  strongWeight: number
  /** Narrow screens (< 640px) and wider screens. px. */
  size: { sm: number; lg: number }
  lineHeight: { sm: number; lg: number }
  /** em */
  letterSpacing: number
  /** Preferred measure, in ch of this face. */
  measure: number
  /** Space between paragraphs, em. */
  paragraphGap: number
  opening: {
    kind: OpeningKind
    /** em, relative to body size */
    size: number
    weight: number
    /** Only meaningful for dropcap — how many body lines it spans. */
    lines?: number
    /** Narrow screens (< 640px) — a phone measure can’t carry as tall an
     *  initial. Defaults to `lines` / `size`. */
    linesSm?: number
    sizeSm?: number
    /** em — nudges the floated initial into optical alignment. */
    offsetTop?: number
    /** em */
    gap?: number
  }
}

export type WritingStyleDefinition = ProseTypography & {
  id: WritingStyleId
  name: string
  /** Internal/specimen description only — never shown as a personality. */
  character: string
  /** Human name of the underlying face — internal and specimen only. */
  face: string
}

// Tempa's canonical long-form prose (Newsreader) — the Reader view, the
// presentation of anything written before Writing Styles existed, and the
// safe fallback for a null/invalid style. Mirrors the long-standing
// proseBodyClass (app/profile/ui.ts: 19px/20px, leading-relaxed, space-y-4).
export const TEMPA_PROSE_TYPOGRAPHY: ProseTypography = {
  familyVar: '--font-newsreader',
  fallback: "ui-serif, Georgia, 'Noto Serif', 'Times New Roman', serif",
  weights: [400, 700],
  bodyWeight: 400,
  strongWeight: 600,
  size: { sm: 19, lg: 20 },
  lineHeight: { sm: 1.625, lg: 1.625 },
  letterSpacing: 0,
  measure: 68,
  paragraphGap: 0.84,
  opening: { kind: 'none', size: 1, weight: 400 },
}

const SERIF_FALLBACK = `var(--font-newsreader), ${TEMPA_PROSE_TYPOGRAPHY.fallback}`

export const WRITING_STYLES: Record<WritingStyleId, WritingStyleDefinition> = {
  ink: {
    id: 'ink',
    name: 'Ink',
    face: 'Kalam',
    character: 'Natural, warm handwritten correspondence.',
    familyVar: '--font-kalam',
    fallback: SERIF_FALLBACK,
    weights: [400, 700],
    bodyWeight: 400,
    strongWeight: 700,
    size: { sm: 18, lg: 19 },
    lineHeight: { sm: 1.72, lg: 1.75 },
    letterSpacing: 0,
    measure: 60,
    paragraphGap: 0.9,
    opening: { kind: 'initial', size: 1.5, weight: 700 },
  },
  notebook: {
    id: 'notebook',
    name: 'Notebook',
    face: 'Patrick Hand',
    character: 'Neat, highly legible everyday handwriting.',
    familyVar: '--font-patrick-hand',
    fallback: SERIF_FALLBACK,
    weights: [400],
    bodyWeight: 400,
    strongWeight: 700,
    size: { sm: 20, lg: 21 },
    lineHeight: { sm: 1.55, lg: 1.6 },
    letterSpacing: 0.005,
    measure: 64,
    paragraphGap: 0.85,
    opening: { kind: 'initial', size: 1.4, weight: 400 },
  },
  freehand: {
    id: 'freehand',
    name: 'Freehand',
    face: 'Caveat',
    character: 'Looser, expressive handwritten correspondence.',
    familyVar: '--font-caveat',
    fallback: SERIF_FALLBACK,
    weights: [400, 700],
    bodyWeight: 400,
    strongWeight: 700,
    size: { sm: 24, lg: 26 },
    lineHeight: { sm: 1.38, lg: 1.4 },
    letterSpacing: 0.005,
    measure: 60,
    paragraphGap: 0.7,
    opening: { kind: 'initial', size: 1.35, weight: 700 },
  },
  literary: {
    id: 'literary',
    name: 'Literary',
    face: 'Lora',
    character: 'Contemporary literary serif suitable for substantial prose.',
    familyVar: '--font-lora',
    fallback: SERIF_FALLBACK,
    weights: [400, 700],
    bodyWeight: 400,
    strongWeight: 600,
    size: { sm: 18, lg: 19 },
    lineHeight: { sm: 1.7, lg: 1.72 },
    letterSpacing: 0,
    measure: 64,
    paragraphGap: 0.85,
    opening: { kind: 'dropcap', size: 3.05, weight: 400, lines: 2, offsetTop: 0.07, gap: 0.08 },
  },
  correspondence: {
    id: 'correspondence',
    name: 'Correspondence',
    face: 'EB Garamond',
    character: 'Classical personal correspondence and traditional book typography.',
    familyVar: '--font-eb-garamond',
    fallback: SERIF_FALLBACK,
    weights: [400, 700],
    bodyWeight: 400,
    strongWeight: 600,
    size: { sm: 20, lg: 21.5 },
    lineHeight: { sm: 1.6, lg: 1.62 },
    letterSpacing: 0.004,
    measure: 66,
    paragraphGap: 0.8,
    // 3 lines on wider screens; 2 on a phone, where a 3-line initial took
    // about a third of the measure.
    opening: { kind: 'dropcap', size: 4.1, sizeSm: 3.1, weight: 400, lines: 3, linesSm: 2, offsetTop: 0.05, gap: 0.07 },
  },
  typewriter: {
    id: 'typewriter',
    name: 'Typewriter',
    face: 'Courier Prime',
    character: 'Deliberate analogue, typewritten correspondence.',
    // Face only — see writingStyleFontFaceVars (app/writing-style-fonts.ts).
    familyVar: '--font-courier-prime-face',
    // Referenced without next/font's Arial fallback face: Courier New has
    // Courier Prime's advance width (both 0.6em), so it is both the steadier
    // swap-in and a monospaced home for scripts Courier Prime lacks
    // (Cyrillic, Greek).
    fallback: "'Courier New', 'Liberation Mono', 'Nimbus Mono PS', ui-monospace, Menlo, Consolas, 'DejaVu Sans Mono', monospace",
    weights: [400, 700],
    bodyWeight: 400,
    strongWeight: 700,
    // Monospaced: ~28 characters per line on a 375px phone at 15px,
    // against ~25 at 16px — the narrow screen gets its own size.
    size: { sm: 15, lg: 17 },
    lineHeight: { sm: 1.68, lg: 1.72 },
    letterSpacing: 0,
    measure: 62,
    paragraphGap: 1.1,
    opening: { kind: 'none', size: 1, weight: 400 },
  },
}

export const WRITING_STYLE_LIST: readonly WritingStyleDefinition[] = WRITING_STYLE_IDS.map((id) => WRITING_STYLES[id])

export function isWritingStyleId(value: unknown): value is WritingStyleId {
  return typeof value === 'string' && (WRITING_STYLE_IDS as readonly string[]).includes(value)
}

/** Anything read from storage passes through here: an unknown string,
 *  wrong type, or missing field is simply "no style". */
export function normalizeWritingStyleId(value: unknown): WritingStyleId | null {
  return isWritingStyleId(value) ? value : null
}

export type ReadingMode = 'original' | 'reader'

/** The typography a piece of authored prose is actually set in. */
export function resolveProseTypography(styleId: unknown, mode: ReadingMode = 'original'): ProseTypography {
  const id = normalizeWritingStyleId(styleId)
  if (mode === 'reader' || !id) return TEMPA_PROSE_TYPOGRAPHY
  return WRITING_STYLES[id]
}

/** Custom properties consumed by `.authored-prose` in app/globals.css.
 *  Every value is produced here from the registry — never from stored
 *  data — so a profile row can never inject CSS. */
export function proseTypographyVars(t: ProseTypography): Record<string, string> {
  return {
    '--wp-family': `var(${t.familyVar}), ${t.fallback}`,
    '--wp-weight': String(t.bodyWeight),
    '--wp-strong': String(t.strongWeight),
    '--wp-size-sm': `${t.size.sm}px`,
    '--wp-size-lg': `${t.size.lg}px`,
    '--wp-leading-sm': String(t.lineHeight.sm),
    '--wp-leading-lg': String(t.lineHeight.lg),
    '--wp-tracking': `${t.letterSpacing}em`,
    '--wp-measure': `${t.measure}ch`,
    '--wp-gap': `${t.paragraphGap}em`,
    '--wp-open-size': `${t.opening.size}em`,
    '--wp-open-size-sm': `${t.opening.sizeSm ?? t.opening.size}em`,
    '--wp-open-weight': String(t.opening.weight),
    '--wp-open-lines': String(t.opening.lines ?? 2),
    '--wp-open-lines-sm': String(t.opening.linesSm ?? t.opening.lines ?? 2),
    '--wp-open-offset': `${t.opening.offsetTop ?? 0}em`,
    '--wp-open-gap': `${t.opening.gap ?? 0}em`,
  }
}

// ============================================================
// COMPOSITION — presentation-level structure. Never mutates stored text;
// only decides which rendered paragraph gets which quiet treatment.
// ============================================================

export type ParagraphRole = 'salutation' | 'opening' | 'body' | 'signoff'

// A salutation is recognised only when it is its OWN short paragraph that
// ends the way a greeting ends ("Dear Mia,", "Hi Sam —", "Querida Ana:").
// Anything less certain is left alone: a wrong guess would put the
// opening treatment in the wrong place, which is worse than none.
const SALUTATION_MAX_CHARS = 48
const SALUTATION_END = /[,:—–!]\s*$/u
const SENTENCE_INSIDE = /[.?!]\s+\S/u

const SIGNOFF_MAX_LINES = 3
const SIGNOFF_LINE_MAX_CHARS = 36

function visibleText(paragraph: string, isRich: boolean): string {
  // Bold/italic delimiters are markup, not text (see lib/letter-editor-doc.ts).
  return isRich ? paragraph.replace(/\\(.)/gu, '$1').replace(/\*\*|_/gu, '') : paragraph
}

export function isSalutation(paragraph: string, isRich = false): boolean {
  const text = visibleText(paragraph, isRich).trim()
  if (!text || text.includes('\n')) return false
  if (Array.from(text).length > SALUTATION_MAX_CHARS) return false
  if (SENTENCE_INSIDE.test(text)) return false
  return SALUTATION_END.test(text)
}

export function isSignOff(paragraph: string, isRich = false): boolean {
  const lines = visibleText(paragraph, isRich).trim().split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0 || lines.length > SIGNOFF_MAX_LINES) return false
  if (lines.some((l) => Array.from(l).length > SIGNOFF_LINE_MAX_CHARS)) return false
  // "With love," / "Yours, Maya" / "— Maya": the valediction ends in a
  // comma (optionally followed by a name on the same or next line), or
  // is a dash-led signature.
  const [first] = lines
  if (/^[—–-]\s*\S/u.test(first) && lines.length === 1) return true
  if (lines.length === 1) return /^[^.?!]{1,24},\s*[^,.?!]{0,24}$/u.test(first) && !SENTENCE_INSIDE.test(first)
  return /,\s*$/u.test(first) && !SENTENCE_INSIDE.test(lines.join(' '))
}

/** Opening treatments only apply when the paragraph genuinely begins with
 *  a letter or number — optionally preceded by opening quotation marks
 *  or an apostrophe (CSS ::first-letter carries that punctuation with
 *  the letter). An emoji, symbol, dash or bracket start gets the plain
 *  opening instead of an enlarged pictograph. */
export function beginsTypographically(paragraph: string, isRich = false): boolean {
  const text = visibleText(paragraph, isRich).trimStart()
  // Opening quote or apostrophe (straight, curly, low-9, guillemets) —
  // U+2019 included for the elided-word apostrophe (’Tis, ’90s).
  return /^["'“”‘’‚„«»‹›]?[\p{L}\p{N}]/u.test(text)
}

export type ProseComposition = { roles: ParagraphRole[]; openingIndex: number | null }

/**
 * Assigns each rendered paragraph a presentation role. Predictable rules:
 *  - paragraph 0 is a salutation only if isSalutation() says so AND
 *    something follows it;
 *  - the opening is the first non-salutation paragraph, and only if it
 *    begins typographically;
 *  - the last paragraph is a sign-off only in writing of 3+ paragraphs.
 */
export function composeProse(paragraphs: readonly string[], isRich = false): ProseComposition {
  const roles: ParagraphRole[] = paragraphs.map(() => 'body')
  if (paragraphs.length === 0) return { roles, openingIndex: null }

  let first = 0
  if (paragraphs.length > 1 && isSalutation(paragraphs[0], isRich)) {
    roles[0] = 'salutation'
    first = 1
  }

  const last = paragraphs.length - 1
  if (paragraphs.length >= 3 && last > first && isSignOff(paragraphs[last], isRich)) {
    roles[last] = 'signoff'
  }

  let openingIndex: number | null = null
  if (roles[first] === 'body' && beginsTypographically(paragraphs[first], isRich)) {
    roles[first] = 'opening'
    openingIndex = first
  }
  return { roles, openingIndex }
}

// ============================================================
// PREVIEW — the member's own words, shown in all six styles.
// ============================================================

/** Used only when a member has genuinely written nothing yet. */
export const WRITING_STYLE_FALLBACK_SAMPLE =
  'I have been meaning to write this for a while. Some things are easier to say slowly, on a page, than quickly out loud — and I would rather take my time.'

/** A short, whole-sentence excerpt of a member's own writing for the
 *  six-style preview. Never cuts mid-word; adds an ellipsis only when it
 *  genuinely shortened the text. */
export function previewExcerpt(text: string | null | undefined, maxChars = 280): string | null {
  if (!text) return null
  const clean = text.replace(/\s*\n\s*\n\s*/gu, '\n\n').trim()
  if (!clean) return null
  const chars = Array.from(clean)
  if (chars.length <= maxChars) return clean

  const window = chars.slice(0, maxChars).join('')
  const sentenceEnd = Math.max(
    ...['. ', '? ', '! ', '.\n', '?\n', '!\n', '… '].map((m) => window.lastIndexOf(m))
  )
  if (sentenceEnd >= maxChars * 0.45) return window.slice(0, sentenceEnd + 1).trim()
  const wordEnd = window.search(/\s\S*$/u)
  return `${(wordEnd > 0 ? window.slice(0, wordEnd) : window).trimEnd().replace(/[,;:—–-]$/u, '')}…`
}

/** Rendering long-form Reader view is offered only where it can matter. */
export const READER_VIEW_MIN_CHARS = 1200

export function offersReaderView(styleId: unknown, body: string): boolean {
  return normalizeWritingStyleId(styleId) !== null && Array.from(body.trim()).length >= READER_VIEW_MIN_CHARS
}

// ============================================================
// COPY — kept restrained; the step explains nothing about typography.
// ============================================================

export const WRITING_STYLE_HEADING = 'Give your words a shape.'

/** The same line for everyone who needs to choose — a new member after the
 *  Flagship Question and an existing member meeting the step once. */
export const WRITING_STYLE_INTRO = 'Choose how your writing appears when it reaches someone.'
