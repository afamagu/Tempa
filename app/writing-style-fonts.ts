import type { CSSProperties } from 'react'
import { Caveat, Courier_Prime, EB_Garamond, Kalam, Lora, Patrick_Hand } from 'next/font/google'

// Writing Style faces (lib/writing-style.ts owns which style uses which).
// Same loader as the rest of Tempa's typography (app/layout.tsx): next/font
// self-hosts the files at build time — no runtime request to Google — and
// generates metric-adjusted fallbacks to keep layout shift small.
//
// All six are SIL Open Font License 1.1 families from Google Fonts.
//
// preload: false — these only matter where a member's authored prose is on
// screen. The @font-face rules are global (cheap), but a browser fetches a
// file only when text actually renders in that face, and only for the
// unicode-range subsets that text touches. next/font emits every subset the
// family has (so e.g. Caveat/Lora render Cyrillic in-face); `subsets` below
// only names what would be preloaded. display: 'swap' keeps text readable.
//
// Unsupported-script fallback (verified 2026-09-29): each family's
// next/font fallback is a metric-matched local() face with no
// unicode-range — Arial for the handwriting faces, Times New Roman for the
// serifs — so a script the face lacks renders legibly in that system face.
// Caveat is NOT used as a Cyrillic fallback for Ink/Notebook: next/font
// registers it as one family ("Caveat") including its Latin faces, so it
// cannot be scoped to Cyrillic; placed ahead of Kalam's fallback it would
// catch Latin text during Kalam's swap period (extra download, visible
// Caveat→Kalam flash). Left for the language-infrastructure work.
//
// Weights: 400 body + 700 for the letter/Dispatch **bold** markup. Italic
// only where the face has a true italic (the handwriting faces have none;
// the browser slants them for the rare _italic_ run).

export const kalam = Kalam({
  variable: '--font-kalam',
  weight: ['400', '700'],
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  preload: false,
})

export const patrickHand = Patrick_Hand({
  variable: '--font-patrick-hand',
  weight: '400',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  preload: false,
})

export const caveat = Caveat({
  variable: '--font-caveat',
  weight: ['400', '700'],
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  display: 'swap',
  preload: false,
})

export const lora = Lora({
  variable: '--font-lora',
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  display: 'swap',
  preload: false,
})

export const ebGaramond = EB_Garamond({
  variable: '--font-eb-garamond',
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin', 'latin-ext', 'cyrillic', 'greek'],
  display: 'swap',
  preload: false,
})

export const courierPrime = Courier_Prime({
  variable: '--font-courier-prime',
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  preload: false,
})

/** A family's own face name, without next/font's Arial fallback face —
 * e.g. "'Courier Prime'" from "'Courier Prime', 'Courier Prime Fallback'". */
export function primaryFontFamily(fontFamily: string): string {
  return fontFamily.split(',')[0].trim()
}

/** Inline custom properties for <html>. Typewriter uses its face WITHOUT
 * the Arial fallback face (Turbopack's next/font still emits that face
 * with adjustFontFallback: false, so the option is not relied on): its
 * registry fallback — Courier New, then system monospace — then takes
 * over, matching Courier Prime's 0.6em advance and keeping scripts it
 * lacks (Cyrillic, Greek) monospaced. */
export const writingStyleFontFaceVars = {
  '--font-courier-prime-face': primaryFontFamily(courierPrime.style.fontFamily),
} as CSSProperties

/** Class list for <html> — defines the six CSS variables only. */
export const writingStyleFontVariables = [kalam, patrickHand, caveat, lora, ebGaramond, courierPrime]
  .map((f) => f.variable)
  .join(' ')
