import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'
import es from '@/messages/es.json'
import pt from '@/messages/pt.json'
import AppShell from './app-shell'

const DICTIONARIES = { en, fr, es, pt } as const
const HREFS = ['/home', '/letters', '/room', '/board', '/you']

function render(locale: keyof typeof DICTIONARIES, waitingLetterCount = 0) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={DICTIONARIES[locale]}>
      <AppShell active="letters" waitingLetterCount={waitingLetterCount}>
        <p>content</p>
      </AppShell>
    </NextIntlClientProvider>
  )
}

const EXPECTED = {
  en: ['Home', 'Letterbox', 'The Room', 'The Board', 'You'],
  fr: ['Accueil', 'Boîte aux lettres', 'La Salle', 'Le Tableau', 'Vous'],
  es: ['Inicio', 'Buzón', 'La Sala', 'El Tablón', 'Tú'],
  pt: ['Início', 'Caixa de cartas', 'A Sala', 'O Mural', 'Você'],
} as const

describe('AppShell navigation is localized from the dictionaries', () => {
  for (const locale of ['en', 'fr', 'es', 'pt'] as const) {
    it(`${locale}: desktop and mobile show the same translated labels, hrefs unchanged`, () => {
      const html = render(locale)
      const desktop = html.slice(html.indexOf('<nav class="hidden'), html.indexOf('<nav class="fixed'))
      const mobile = html.slice(html.indexOf('<nav class="fixed'))
      for (const label of EXPECTED[locale]) {
        expect(desktop).toContain(`>${label}<`)
        expect(mobile).toContain(`>${label}</span>`)
      }
      for (const href of HREFS) expect((html.match(new RegExp(`href="${href}"`, 'g')) ?? []).length).toBe(2)
      expect(html).not.toMatch(/href="\/(en|fr|es|pt)\//)
      expect(html).toContain('>Tempa<')
    })
  }

  it('legacy minds active state maps to the canonical Room item', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={en}>
        <AppShell active="minds" waitingLetterCount={0}>{null}</AppShell>
      </NextIntlClientProvider>
    )
    const roomIndex = html.indexOf('href="/room"')
    const tagStart = html.lastIndexOf('<a ', roomIndex)
    const tagEnd = html.indexOf('</a>', roomIndex)
    expect(html.slice(tagStart, tagEnd)).toContain('bg-accent/10')
  })

  it('letter badge behaviour is unchanged in every language', () => {
    for (const locale of ['en', 'fr'] as const) {
      expect(render(locale, 3)).toContain('h-2 w-2 rounded-full bg-accent')
      expect(render(locale, 0)).not.toContain('h-2 w-2 rounded-full bg-accent')
    }
  })
})
