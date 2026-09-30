/**
 * Tempa's Reading language registry — the ONE list of languages a member can
 * ask Tempa to translate someone's writing into.
 *
 * - Every `code` is the exact Azure Translator v3 tag, verified against the
 *   provider's live /languages?scope=translation list on 2026-09-30 (snapshot:
 *   lib/translation/azure-languages-2026-09-30.snapshot.json, enforced by
 *   lib/reading-languages.test.ts). Never invent a code.
 * - `direction` comes from the same provider list, so an Arabic/Hebrew/Urdu
 *   translation can render right-to-left on its own reading surface.
 * - A broad, deliberately curated launch subset. Adding a language is one
 *   entry here; the database only checks a code's SHAPE, so no migration.
 * - No flags and no country anywhere: a language is not a country, and a
 *   member's location never implies what they read.
 *
 * Client-safe (no server-only imports): the picker renders from this list.
 */

export type LanguageDirection = 'ltr' | 'rtl'

export type ReadingLanguage = {
  /** Provider tag (BCP-47 compatible), e.g. es, pt-PT, zh-Hans, sr-Latn. */
  code: string
  /** English display name. */
  name: string
  /** The language's name for itself. */
  nativeName: string
  direction: LanguageDirection
}

const L = (code: string, name: string, nativeName: string, direction: LanguageDirection = 'ltr'): ReadingLanguage => ({
  code,
  name,
  nativeName,
  direction,
})

export const READING_LANGUAGES: readonly ReadingLanguage[] = [
  L('af', 'Afrikaans', 'Afrikaans'),
  L('sq', 'Albanian', 'Shqip'),
  L('am', 'Amharic', 'አማርኛ'),
  L('ar', 'Arabic', 'العربية', 'rtl'),
  L('hy', 'Armenian', 'Հայերեն'),
  L('az', 'Azerbaijani', 'Azərbaycan'),
  L('eu', 'Basque', 'Euskara'),
  L('be', 'Belarusian', 'Беларуская'),
  L('bn', 'Bengali', 'বাংলা'),
  L('bs', 'Bosnian', 'Bosanski'),
  L('bg', 'Bulgarian', 'Български'),
  L('my', 'Burmese', 'မြန်မာ'),
  L('yue', 'Cantonese (Traditional)', '粵語 (繁體)'),
  L('ca', 'Catalan', 'Català'),
  L('zh-Hans', 'Chinese (Simplified)', '中文 (简体)'),
  L('zh-Hant', 'Chinese (Traditional)', '中文 (繁體)'),
  L('hr', 'Croatian', 'Hrvatski'),
  L('cs', 'Czech', 'Čeština'),
  L('da', 'Danish', 'Dansk'),
  L('prs', 'Dari', 'دری', 'rtl'),
  L('nl', 'Dutch', 'Nederlands'),
  L('en', 'English', 'English'),
  L('et', 'Estonian', 'Eesti'),
  L('fil', 'Filipino', 'Filipino'),
  L('fi', 'Finnish', 'Suomi'),
  L('fr', 'French', 'Français'),
  L('fr-CA', 'French (Canada)', 'Français (Canada)'),
  L('gl', 'Galician', 'Galego'),
  L('ka', 'Georgian', 'ქართული'),
  L('de', 'German', 'Deutsch'),
  L('el', 'Greek', 'Ελληνικά'),
  L('gu', 'Gujarati', 'ગુજરાતી'),
  L('ht', 'Haitian Creole', 'Kreyòl ayisyen'),
  L('ha', 'Hausa', 'Hausa'),
  L('he', 'Hebrew', 'עברית', 'rtl'),
  L('hi', 'Hindi', 'हिन्दी'),
  L('hu', 'Hungarian', 'Magyar'),
  L('is', 'Icelandic', 'Íslenska'),
  L('ig', 'Igbo', 'Asụsụ Igbo'),
  L('id', 'Indonesian', 'Bahasa Indonesia'),
  L('ga', 'Irish', 'Gaeilge'),
  L('it', 'Italian', 'Italiano'),
  L('ja', 'Japanese', '日本語'),
  L('kn', 'Kannada', 'ಕನ್ನಡ'),
  L('kk', 'Kazakh', 'Қазақ тілі'),
  L('km', 'Khmer', 'ខ្មែរ'),
  L('rw', 'Kinyarwanda', 'Kinyarwanda'),
  L('ko', 'Korean', '한국어'),
  L('ku', 'Kurdish (Central)', 'کوردیی ناوەندی', 'rtl'),
  L('kmr', 'Kurdish (Northern)', 'Kurdî (Bakur)'),
  L('ky', 'Kyrgyz', 'Кыргызча'),
  L('lo', 'Lao', 'ລາວ'),
  L('lv', 'Latvian', 'Latviešu'),
  L('ln', 'Lingala', 'Lingála'),
  L('lt', 'Lithuanian', 'Lietuvių'),
  L('lb', 'Luxembourgish', 'Lëtzebuergesch'),
  L('mk', 'Macedonian', 'Македонски'),
  L('mg', 'Malagasy', 'Malagasy'),
  L('ms', 'Malay', 'Bahasa Melayu'),
  L('ml', 'Malayalam', 'മലയാളം'),
  L('mt', 'Maltese', 'Malti'),
  L('mi', 'Māori', 'Te Reo Māori'),
  L('mr', 'Marathi', 'मराठी'),
  L('mn-Cyrl', 'Mongolian', 'Монгол'),
  L('ne', 'Nepali', 'नेपाली'),
  L('nb', 'Norwegian', 'Norsk bokmål'),
  L('nya', 'Nyanja', 'Chinyanja'),
  L('or', 'Odia', 'ଓଡ଼ିଆ'),
  L('ps', 'Pashto', 'پښتو', 'rtl'),
  L('fa', 'Persian', 'فارسی', 'rtl'),
  L('pl', 'Polish', 'Polski'),
  L('pt', 'Portuguese (Brazil)', 'Português (Brasil)'),
  L('pt-PT', 'Portuguese (Portugal)', 'Português (Portugal)'),
  L('pa', 'Punjabi', 'ਪੰਜਾਬੀ'),
  L('ro', 'Romanian', 'Română'),
  L('ru', 'Russian', 'Русский'),
  L('sm', 'Samoan', 'Gagana Sāmoa'),
  L('sr-Cyrl', 'Serbian (Cyrillic)', 'Српски (ћирилица)'),
  L('sr-Latn', 'Serbian (Latin)', 'Srpski (latinica)'),
  L('st', 'Sesotho', 'Sesotho'),
  L('tn', 'Setswana', 'Setswana'),
  L('sn', 'Shona', 'chiShona'),
  L('sd', 'Sindhi', 'سنڌي', 'rtl'),
  L('si', 'Sinhala', 'සිංහල'),
  L('sk', 'Slovak', 'Slovenčina'),
  L('sl', 'Slovenian', 'Slovenščina'),
  L('so', 'Somali', 'Soomaali'),
  L('es', 'Spanish', 'Español'),
  L('es-MX', 'Spanish (Mexico)', 'Español (México)'),
  L('sw', 'Swahili', 'Kiswahili'),
  L('sv', 'Swedish', 'Svenska'),
  L('ta', 'Tamil', 'தமிழ்'),
  L('tt', 'Tatar', 'Татар'),
  L('te', 'Telugu', 'తెలుగు'),
  L('th', 'Thai', 'ไทย'),
  L('ti', 'Tigrinya', 'ትግርኛ'),
  L('to', 'Tongan', 'Lea Fakatonga'),
  L('tr', 'Turkish', 'Türkçe'),
  L('tk', 'Turkmen', 'Türkmen dili'),
  L('uk', 'Ukrainian', 'Українська'),
  L('ur', 'Urdu', 'اردو', 'rtl'),
  L('ug', 'Uyghur', 'ئۇيغۇرچە', 'rtl'),
  L('uz', 'Uzbek', 'Oʻzbek'),
  L('vi', 'Vietnamese', 'Tiếng Việt'),
  L('cy', 'Welsh', 'Cymraeg'),
  L('xh', 'Xhosa', 'isiXhosa'),
  L('yo', 'Yoruba', 'Èdè Yorùbá'),
  L('zu', 'Zulu', 'isiZulu'),
]

const BY_CODE = new Map(READING_LANGUAGES.map((language) => [language.code, language]))
const BY_LOWER_CODE = new Map(READING_LANGUAGES.map((language) => [language.code.toLowerCase(), language]))

/** The registry entry for an exact supported code, else null. Case-
 * insensitive on input, always returns the canonical provider casing. */
export function readingLanguage(code: unknown): ReadingLanguage | null {
  if (typeof code !== 'string') return null
  const trimmed = code.trim()
  return BY_CODE.get(trimmed) ?? BY_LOWER_CODE.get(trimmed.toLowerCase()) ?? null
}

export function isSupportedReadingLanguage(code: unknown): code is string {
  return readingLanguage(code) !== null
}

/** Anything read from storage passes through here: an unknown code reads
 * back as "not chosen" rather than an unsupported target. */
export function normalizeReadingLanguage(code: unknown): string | null {
  return readingLanguage(code)?.code ?? null
}

export function languageDirection(code: unknown): LanguageDirection {
  return readingLanguage(code)?.direction ?? 'ltr'
}

/**
 * A readable English name for any provider language code — including a
 * DETECTED source language that is not a Reading language option (e.g.
 * "Translated from Bhojpuri"). Registry first, then the platform's own
 * Intl.DisplayNames; null if neither knows it (callers then say "Translated"
 * without naming a language rather than printing a raw code).
 */
export function languageDisplayName(code: unknown): string | null {
  const known = readingLanguage(code)
  if (known) return known.name
  if (typeof code !== 'string' || !code.trim()) return null
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' }).of(code.trim())
    return name ?? null
  } catch {
    return null
  }
}

function fold(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** Picker search over English name, native name and code (diacritic- and
 * case-insensitive). An empty query returns the whole registry in order. */
export function searchReadingLanguages(query: string): ReadingLanguage[] {
  const q = fold(query.trim())
  if (!q) return [...READING_LANGUAGES]
  return READING_LANGUAGES.filter(
    (language) =>
      fold(language.name).includes(q) || fold(language.nativeName).includes(q) || language.code.toLowerCase() === q
  )
}

/**
 * A NON-BINDING suggestion from the browser's own language list
 * (navigator.languages). Only ever used to highlight an option in the
 * picker — never saved without the member choosing it, and never derived
 * from country or location. Tries the full tag, then script-aware and
 * primary-subtag matches (zh-TW → zh-Hant, pt-BR → pt, en-GB → en).
 */
export function suggestReadingLanguage(browserLanguages: readonly string[]): string | null {
  for (const raw of browserLanguages) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    const tag = raw.trim()
    const exact = readingLanguage(tag)
    if (exact) return exact.code
    const lower = tag.toLowerCase()
    if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo') return 'zh-Hant'
    if (lower.startsWith('zh')) return 'zh-Hans'
    if (lower === 'pt-br') return 'pt'
    const primary = readingLanguage(lower.split('-')[0])
    if (primary) return primary.code
  }
  return null
}
