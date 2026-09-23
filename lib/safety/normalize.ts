// Safety 2 — normalization stage. Three distinct outputs, deliberately
// kept separate because they have incompatible goals — folding them
// into one "do everything" pass causes transformations to fight each
// other (e.g. de-leeting "0" -> "o" for words directly conflicts with
// de-obfuscating "O" -> "0" for numbers):
//
//   - `display` text: Unicode NFKC + zero-width-character stripping
//     only. Meaning-preserving, safe to extract real structured data
//     from (URLs, emails, phone-like sequences) — nothing here would
//     ever change what a human reads.
//   - `canonical` text: `display` PLUS homoglyph folding, letter-based
//     leet-speak substitution, and letter-spacing collapse. Aggressive
//     and lossy by design — exists ONLY for keyword/phrase matching
//     against obfuscation attempts ("m0ney", "s.e.n.d", Cyrillic
//     lookalikes). Never use this for anything a human would see or
//     that requires byte-accuracy (URLs, exact quoting, amounts).
//   - `numeric` text: `display` with spaced-out/letter-obfuscated
//     digit runs folded back into plain numbers ("$ 3 0 0" / "3OO" ->
//     "300"). Used only by the currency-amount extractor — kept
//     separate from `canonical` specifically so it never re-collides
//     with the letter-substitution pass above.
//
// All three are pure functions of the input string — no I/O, no
// external calls, matching this module's role as classifier UX/
// detection only (see lib/safety/classify.ts's own header for the
// authority boundary: none of this is the authoritative decision).

/** Zero-width and other invisible characters sometimes used to break
 * up a word for filter evasion (zero-width space/joiner/non-joiner,
 * word joiner, BOM). Stripped entirely — they carry no visible
 * meaning. */
const ZERO_WIDTH_PATTERN = /[​-‍⁠﻿]/g

/** Common visually-confusable characters (Cyrillic/Greek → Latin
 * lookalikes) that Unicode NFKC does NOT fold, because they are
 * distinct letters in distinct scripts, not compatibility variants of
 * the same letter. Deliberately conservative — only characters that
 * are near-perfect visual matches for a Latin letter in typical UI
 * fonts, to keep this a matching aid rather than a source of new
 * false positives on genuinely non-English text. */
const HOMOGLYPH_MAP: Record<string, string> = {
  а: 'a', А: 'A', // Cyrillic a
  е: 'e', Е: 'E', // Cyrillic ie
  о: 'o', О: 'O', // Cyrillic o
  р: 'p', Р: 'P', // Cyrillic er
  с: 'c', С: 'C', // Cyrillic es
  у: 'y', У: 'Y', // Cyrillic u
  х: 'x', Х: 'X', // Cyrillic ha
  і: 'i', І: 'I', // Cyrillic/Ukrainian i
  ѕ: 's', Ѕ: 'S', // Cyrillic dze
  ј: 'j', Ј: 'J', // Cyrillic je
}

/** Leet-speak substitutions for the CANONICAL (keyword-matching) pass
 * only — digits/symbols standing in for LETTERS ("m0ney" -> "money",
 * "@ccount" -> "account"). Deliberately does not touch '0' the other
 * direction (digit -> letter 'o' only, never letter -> digit) so this
 * never fights the separate numeric-amount normalization below. */
const LEET_TO_LETTER_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
}

/** Unicode NFKC + zero-width stripping. Meaning-preserving; safe to
 * run structured extraction (URLs, emails, phone numbers) against. */
export function toDisplayText(input: string): string {
  return input.normalize('NFKC').replace(ZERO_WIDTH_PATTERN, '')
}

/** Collapses "b.u.y" / "s-e-n-d" / "s_e_n_d" style letter-spacing — a
 * run of 3+ single alphanumeric characters each separated by a single
 * period/hyphen/underscore — back into one contiguous token, so
 * downstream keyword matching isn't defeated by artificial spacing.
 * The 3-character minimum is intentional: many of the short but
 * important keywords this system matches ("buy", "pay") are only 3
 * letters, so a longer minimum would leave exactly the words that
 * matter most uncollapsed. A shorter, 2-character minimum was
 * considered and rejected — it would start catching genuinely
 * ambiguous 2-letter hyphenated tokens ("m-e") that are just as
 * plausibly a real abbreviation as an obfuscation attempt.
 * Deliberately does NOT treat a bare space as a valid separator here:
 * unlike punctuation between single letters (a strong, low-false-
 * positive obfuscation signal), a plain space between short tokens is
 * indistinguishable from ordinary multi-word text ("a b c", single-
 * letter words) — collapsing across spaces would risk merging two
 * separate genuine words (e.g. "send money" -> "sendmoney"). */
function collapseLetterSpacing(text: string): string {
  const runPattern = /\b(?:[A-Za-z0-9][.\-_]){2,}[A-Za-z0-9]\b/g
  return text.replace(runPattern, (match) => match.replace(/[.\-_]/g, ''))
}

/** The aggressive, matching-only canonicalization: display text, then
 * letter-spacing collapse, homoglyph folding, leet-to-letter
 * substitution, lowercased. Never use this for anything that must
 * preserve exact user-authored text (display, storage, fingerprinting)
 * or exact numeric amounts (use toNumericText for those) — see this
 * file's own header. */
export function toCanonicalText(input: string): string {
  let text = toDisplayText(input)
  text = collapseLetterSpacing(text)
  text = Array.from(text)
    .map((char) => HOMOGLYPH_MAP[char] ?? char)
    .join('')
  text = text.replace(/[013457@$]/g, (char) => LEET_TO_LETTER_MAP[char] ?? char)
  return text.toLowerCase()
}

/** Folds obfuscated numeric amounts back into plain digit runs, for
 * the currency-amount extractor only: spaced-out digits ("$ 3 0 0" ->
 * "$300") and a letter O standing in for a digit zero within an
 * otherwise-numeric token ("3OO" -> "300", "1O,OOO" -> "10,000").
 * Scoped to sequences that already contain at least one real digit, so
 * ordinary words ("too", "cool") are never touched. Kept separate from
 * toCanonicalText — seeing this function's own header for why. */
export function toNumericText(input: string): string {
  const text = toDisplayText(input)
  return text
    // "$ 300" -> "$300" first, so a currency symbol never leaves a
    // stray space behind once the digit run itself is collapsed below.
    .replace(/([$€£₦₹¥])\s+(?=\d)/g, '$1')
    .replace(/\b(?:\d[ \-]){1,}\d\b/g, (match) => match.replace(/[ \-]/g, ''))
    .replace(/\b(?=[0-9oO]*\d)[0-9oO,]{2,}\b/g, (match) => match.replace(/[oO]/g, '0'))
}
