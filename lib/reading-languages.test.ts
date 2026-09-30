import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  READING_LANGUAGES,
  isSupportedReadingLanguage,
  languageDirection,
  languageDisplayName,
  normalizeReadingLanguage,
  readingLanguage,
  searchReadingLanguages,
  suggestReadingLanguage,
} from './reading-languages'

type AzureLanguage = { name: string; nativeName: string; dir: 'ltr' | 'rtl' }
const azure = JSON.parse(
  readFileSync(path.join(__dirname, 'translation', 'azure-languages-2026-09-30.snapshot.json'), 'utf8')
).translation as Record<string, AzureLanguage>

describe('Reading language registry — validated against Azure Translator', () => {
  it('every code is a real Azure translation target, with Azure’s own direction', () => {
    for (const language of READING_LANGUAGES) {
      expect(azure[language.code], language.code).toBeDefined()
      expect(language.direction, language.code).toBe(azure[language.code].dir)
    }
  })

  it('is a broad launch set covering the major world languages, with unique codes', () => {
    const codes = READING_LANGUAGES.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes.length).toBeGreaterThanOrEqual(80)
    for (const major of ['en', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi', 'bn', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'id', 'tr', 'vi', 'it', 'pl', 'uk', 'fa', 'ur', 'sw', 'he', 'th']) {
      expect(codes, major).toContain(major)
    }
  })

  it('each entry has an English name, a native name and a direction', () => {
    for (const language of READING_LANGUAGES) {
      expect(language.name.trim()).not.toBe('')
      expect(language.nativeName.trim()).not.toBe('')
      expect(['ltr', 'rtl']).toContain(language.direction)
    }
  })

  it('RTL metadata: Arabic, Hebrew, Persian, Urdu, Pashto read right-to-left; others do not', () => {
    for (const code of ['ar', 'he', 'fa', 'ur', 'ps']) expect(languageDirection(code)).toBe('rtl')
    for (const code of ['en', 'ja', 'zh-Hans', 'hi']) expect(languageDirection(code)).toBe('ltr')
    expect(languageDirection('not-a-language')).toBe('ltr')
  })
})

describe('Reading language lookups', () => {
  it('rejects unknown/unsupported codes; accepts case-insensitively, returns provider casing', () => {
    expect(isSupportedReadingLanguage('es')).toBe(true)
    expect(readingLanguage('ZH-hans')?.code).toBe('zh-Hans')
    for (const bad of ['', 'xx', 'tlh-Latn', 'es; drop table', 42, null, undefined, '<script>']) {
      expect(isSupportedReadingLanguage(bad), String(bad)).toBe(false)
    }
    expect(normalizeReadingLanguage('klingon')).toBeNull()
  })

  it('search matches English name, native name (diacritic-insensitive) and exact code', () => {
    expect(searchReadingLanguages('span').map((l) => l.code)).toEqual(expect.arrayContaining(['es', 'es-MX']))
    expect(searchReadingLanguages('espanol').map((l) => l.code)).toContain('es')
    expect(searchReadingLanguages('日本').map((l) => l.code)).toEqual(['ja'])
    expect(searchReadingLanguages('pt-PT').map((l) => l.code)).toContain('pt-PT')
    expect(searchReadingLanguages('')).toHaveLength(READING_LANGUAGES.length)
  })

  it('display names cover detected languages outside the registry, never a raw code guess', () => {
    expect(languageDisplayName('ja')).toBe('Japanese')
    expect(languageDisplayName('bho')).toBeTruthy()
    expect(languageDisplayName('')).toBeNull()
  })
})

describe('Country never determines language', () => {
  it('the browser suggestion uses only the language list it is given', () => {
    expect(suggestReadingLanguage(['pt-BR', 'en'])).toBe('pt')
    expect(suggestReadingLanguage(['zh-TW'])).toBe('zh-Hant')
    expect(suggestReadingLanguage(['en-GB'])).toBe('en')
    expect(suggestReadingLanguage(['xx-YY'])).toBeNull()
    expect(suggestReadingLanguage([])).toBeNull()
  })

  it('no reading-language module reads country, location or flags', () => {
    const files = [
      'reading-languages.ts',
      'reading-language-data.ts',
      '../app/reading-language-picker.tsx',
      '../app/reading-language-actions.ts',
      '../app/you/reading-language/page.tsx',
      '../app/you/reading-language/reading-language-editor.tsx',
    ]
    for (const file of files) {
      // Code only — the doc comments deliberately SAY country is never used.
      const source = readFileSync(path.join(__dirname, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
      expect(source, file).not.toMatch(/country|country_code|country-flag|geolocation|timezone|region/i)
    }
  })
})
