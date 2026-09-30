import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_LOCALE,
  INTERFACE_LOCALES,
  LOCALE_COOKIE,
  isInterfaceLocale,
  localeDirection,
  matchAcceptLanguage,
  resolveInterfaceLocale,
} from './config'

describe('interface-locale registry', () => {
  it('is exactly English, Français, Español, Português — native names, no flags', () => {
    expect(INTERFACE_LOCALES.map((l) => [l.code, l.nativeName])).toEqual([
      ['en', 'English'],
      ['fr', 'Français'],
      ['es', 'Español'],
      ['pt', 'Português'],
    ])
    expect(DEFAULT_LOCALE).toBe('en')
    expect(LOCALE_COOKIE).toBe('tempa_locale')
  })

  it('direction comes from the registry (ltr for all four; the shape allows rtl)', () => {
    for (const l of INTERFACE_LOCALES) expect(localeDirection(l.code)).toBe(l.direction)
    expect(INTERFACE_LOCALES.every((l) => l.direction === 'ltr')).toBe(true)
  })

  it('allowlist is exact: no prefixes, paths, case games or prototype keys', () => {
    for (const bad of ['EN', 'fr-FR', 'de', '../en', 'en/../../x', 'constructor', '__proto__', '', null, undefined, 42]) {
      expect(isInterfaceLocale(bad), String(bad)).toBe(false)
    }
  })
})

describe('resolveInterfaceLocale — cookie, then Accept-Language, then English', () => {
  it('a valid cookie wins over Accept-Language', () => {
    expect(resolveInterfaceLocale({ cookie: 'fr', acceptLanguage: 'es-ES,es;q=0.9' })).toBe('fr')
  })

  it('an unsupported or tampered cookie falls back safely', () => {
    expect(resolveInterfaceLocale({ cookie: 'de', acceptLanguage: null })).toBe('en')
    expect(resolveInterfaceLocale({ cookie: '../../etc/passwd', acceptLanguage: 'pt-BR' })).toBe('pt')
  })

  it('a supported Accept-Language is used when there is no cookie', () => {
    expect(resolveInterfaceLocale({ cookie: undefined, acceptLanguage: 'es-MX,es;q=0.9,en;q=0.8' })).toBe('es')
    expect(resolveInterfaceLocale({ cookie: undefined, acceptLanguage: 'fr-CA' })).toBe('fr')
  })

  it('defaults to English', () => {
    expect(resolveInterfaceLocale({ cookie: null, acceptLanguage: null })).toBe('en')
    expect(resolveInterfaceLocale({ cookie: null, acceptLanguage: 'de-DE,ja;q=0.5' })).toBe('en')
  })

  it('respects q-weights and q=0 refusals', () => {
    expect(matchAcceptLanguage('de;q=1, pt;q=0.4, fr;q=0.8')).toBe('fr')
    expect(matchAcceptLanguage('fr;q=0, es;q=0.1')).toBe('es')
    expect(matchAcceptLanguage('*')).toBeNull()
    expect(matchAcceptLanguage('')).toBeNull()
  })

  it('a region never selects a language by itself (country is not language)', () => {
    // "en-FR" is English as spoken in France — still English, never French.
    expect(matchAcceptLanguage('en-FR')).toBe('en')
    expect(matchAcceptLanguage('de-BR')).toBeNull()
  })
})

describe('request locale (i18n/request.ts)', () => {
  const state = vi.hoisted(() => ({ cookie: undefined as string | undefined, accept: null as string | null, sets: 0 }))
  vi.mock('next/headers', () => ({
    cookies: async () => ({
      get: (name: string) => (name === 'tempa_locale' && state.cookie !== undefined ? { name, value: state.cookie } : undefined),
      set: () => {
        state.sets++
      },
    }),
    headers: async () => ({ get: (name: string) => (name === 'accept-language' ? state.accept : null) }),
  }))

  beforeEach(() => {
    state.cookie = undefined
    state.accept = null
    state.sets = 0
  })

  it('reads the cookie and Accept-Language, and never writes a cookie', async () => {
    const { resolveRequestLocale } = await import('./request')
    state.accept = 'pt-BR,pt;q=0.9'
    expect(await resolveRequestLocale()).toBe('pt')
    state.cookie = 'es'
    expect(await resolveRequestLocale()).toBe('es')
    state.cookie = 'xx'
    state.accept = null
    expect(await resolveRequestLocale()).toBe('en')
    expect(state.sets).toBe(0) // Accept-Language is never persisted
  })

  it('dictionaries are a static allowlisted map — never a cookie-built import path', async () => {
    const { MESSAGES } = await import('./request')
    expect(Object.keys(MESSAGES)).toEqual(['en', 'fr', 'es', 'pt'])
    const source = readFileSync(path.join(__dirname, 'request.ts'), 'utf8')
    expect(source).not.toMatch(/import\(`|import\(\s*['"`][^'"`]*\$\{/)
    expect(source).toContain('messages: MESSAGES[locale]')
  })

  it('no country, geolocation or IP header is ever consulted', () => {
    for (const file of ['config.ts', 'request.ts']) {
      const code = readFileSync(path.join(__dirname, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
      expect(code, file).not.toMatch(/country|geo|x-vercel-ip|cf-ipcountry|x-forwarded-for|timezone/i)
    }
  })
})
