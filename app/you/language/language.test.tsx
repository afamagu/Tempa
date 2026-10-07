import { describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'

vi.mock('@/app/locale-actions', () => ({ chooseTempaLanguage: async () => ({ ok: true }) }))

const { default: LanguageSettingsEditor } = await import('./language-settings-editor')

const dir = __dirname
const page = readFileSync(path.join(dir, 'page.tsx'), 'utf8')
const editor = readFileSync(path.join(dir, 'language-settings-editor.tsx'), 'utf8')
const you = readFileSync(path.join(dir, '..', 'page.tsx'), 'utf8')
const oldRoute = readFileSync(path.join(dir, '..', 'reading-language', 'page.tsx'), 'utf8')

function render(locale: 'en' | 'fr') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : fr}>
      <LanguageSettingsEditor currentLocale={locale} />
    </NextIntlClientProvider>
  )
}

describe('/you shows Language', () => {
  it('the row says Language (dictionary) and links to /you/language — not Reading language', () => {
    expect(you).toContain('href="/you/language"')
    expect(you).toContain("{t('language')}")
    expect(you).not.toContain('Reading language')
    expect(you).not.toContain('/you/reading-language')
    expect(you).toContain('localeNativeName(locale)')
  })

  it('/you/reading-language permanently redirects to /you/language; its old editor is gone', () => {
    expect(oldRoute).toContain("permanentRedirect('/you/language')")
    expect(existsSync(path.join(dir, '..', 'reading-language', 'reading-language-editor.tsx'))).toBe(false)
  })
})

describe('/you/language', () => {
  it('is signed-in only, with the Language heading and model explanation from the dictionary', () => {
    expect(page).toContain("redirect('/sign-in')")
    expect(page).toContain("getTranslations('LanguageSettings')")
    expect(en.LanguageSettings.heading).toBe('Language')
    expect(en.LanguageSettings.intro).toBe(
      'Choose the language you use on Tempa. Tempa’s menus and controls will use this language.'
    )
    for (const source of [page, editor]) expect(source).not.toMatch(/interface locale|azure/i)
  })

  it('shows the current Tempa language among the four native names', () => {
    const html = render('fr')
    for (const name of ['English', 'Français', 'Español', 'Português']) expect(html).toContain(name)
    const pressed = html.slice(html.indexOf('aria-pressed="true"'))
    expect(pressed.slice(0, pressed.indexOf('</button>'))).toContain('Français')
    expect(html).toContain('Langue de Tempa')
    expect(html).not.toContain('Identique à la langue de Tempa')
  })

  it('primary choice → chooseTempaLanguage (cookie + same reading language)', () => {
    expect(editor).toContain('await chooseTempaLanguage(code)')
  })

  it('does not advertise a separate Translation language before member-facing translation ships', () => {
    const html = render('en')
    expect(html).not.toContain('Translation language')
    expect(html).not.toContain('Choose a different language')
    expect(editor).not.toContain('ReadingLanguagePicker')
    expect(editor).not.toContain('saveReadingLanguage')
    expect(page).not.toContain('getMyReadingLanguage')
  })
})
