import { describe, it, expect } from 'vitest'
import { createTranslator } from 'next-intl'
import en from './en.json'
import fr from './fr.json'
import es from './es.json'
import pt from './pt.json'

const DICTIONARIES = { en, fr, es, pt } as const
type Tree = { [key: string]: string | Tree }

function leaves(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value] as [string, string]] : leaves(value, `${prefix}${key}.`)
  )
}

const englishKeys = leaves(en).map(([key]) => key).sort()
const SAMPLE_VALUES = {
  email: 'support@jointempa.com',
  seconds: 42,
  name: '日本語',
  value: 'French',
  min: 3,
  max: 12,
  day: 13,
  month: 'September',
  year: 2026,
  date: '13 September 2026',
}
const RICH_TAGS = {
  strong: (chunks: string) => `<strong>${chunks}</strong>`,
  language: (chunks: string) => `<span>${chunks}</span>`,
  terms: (chunks: string) => `<a>${chunks}</a>`,
  guidelines: (chunks: string) => `<a>${chunks}</a>`,
  privacy: (chunks: string) => `<a>${chunks}</a>`,
}

describe('interface dictionaries', () => {
  it('every language has exactly the English key structure', () => {
    for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
      expect(leaves(dictionary as Tree).map(([key]) => key).sort(), locale).toEqual(englishKeys)
    }
  })

  it('no empty values, no "undefined", no leftover placeholders', () => {
    for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
      for (const [key, value] of leaves(dictionary as Tree)) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('')
        expect(value, `${locale}:${key}`).not.toMatch(/undefined|TODO|FIXME|\[\[|\bxx\b/)
      }
    }
  })

  it('translations are genuinely translated (not English copied over), except shared/language-neutral values', () => {
    const allowedSame = new Set([
      'SignIn.continueWithGoogle',
      'SignIn.or',
      // Day-month-year order is intentionally shared by English and French;
      // the localized month names still make the rendered date local.
      'Begin.dateFormat',
    ])
    for (const locale of ['fr', 'es', 'pt'] as const) {
      const translated = new Map(leaves(DICTIONARIES[locale] as Tree))
      const identical = leaves(en).filter(([key, value]) => !allowedSame.has(key) && translated.get(key) === value)
      expect(identical.map(([key]) => key), locale).toEqual([])
    }
  })

  it('every message formats in every language, with the same placeholders as English — never a raw key', () => {
    const enLeaves = new Map(leaves(en))
    for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
      const t = createTranslator({ locale: locale as keyof typeof DICTIONARIES, messages: dictionary as typeof en })
      for (const [key, value] of leaves(dictionary as Tree)) {
        const placeholders = (s: string) => Array.from(s.matchAll(/\{(\w+)\}/g), (m) => m[1]).sort()
        expect(placeholders(value), `${locale}:${key}`).toEqual(placeholders(enLeaves.get(key)!))
        const out = /<\/?[a-z][^>]*>/i.test(value)
          ? String(t.markup(key as never, { ...SAMPLE_VALUES, ...RICH_TAGS } as never))
          : String(t(key as never, SAMPLE_VALUES as never))
        expect(out, `${locale}:${key}`).not.toBe(key)
        expect(out, `${locale}:${key}`).not.toContain('{')
        expect(out, `${locale}:${key}`).not.toMatch(/undefined/)
      }
    }
  })

  it('Tempa is never translated', () => {
    for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
      for (const [key, value] of leaves(dictionary as Tree)) {
        if (/tempa/i.test(value)) expect(value, `${locale}:${key}`).toMatch(/Tempa/)
      }
    }
    expect(fr.SignIn.createAccountHeading).toContain('Tempa')
    expect(pt.SignIn.createAccountHeading).toContain('Tempa')
  })
})
