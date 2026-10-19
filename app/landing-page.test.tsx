import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LandingPage from './landing-page'

describe('Tempa people-discovery landing page', () => {
  const html = renderToStaticMarkup(<LandingPage />).replaceAll('&#x27;', "'")

  it('invites visitors to discover people through real conversation rather than abstract promises', () => {
    expect(html).toContain("The world is full of conversations")
    expect(html).toContain("you haven't had.")
    expect(html).toContain('DISCOVER PEOPLE BEYOND YOUR EVERYDAY WORLD')
    expect(html).toContain('On Tempa, you discover them through open letters.')
    expect(html).toContain('write privately to the person behind it')
    expect(html).toContain('leave a letter of your own and see who responds')
    expect(html).not.toContain('People are easy to find.')
    expect(html).not.toContain('Know the person, not the profile.')
    expect(html).not.toContain('Social media that feels human again.')
  })

  it('features a specific adult dilemma and contrasting illustrative personalities', () => {
    for (const text of [
      'The offer I worked fifteen years for',
      'furniture-making courses',
      'Has anyone else worked this hard for something they no longer want?',
      'My mother is still waiting for a doctor.',
      'She was an accountant.',
      'The thing I miss about home.',
      "being rude in my first language",
      'I told her not to marry him.',
      'It had headings.',
    ]) {
      expect(html).toContain(text)
    }
    expect(html.match(/Illustrative open letter/g)).toHaveLength(4)
    expect(html).not.toContain('Sunday lunch')
    expect(html).not.toContain('The woman at the orange stand')
    expect(html).not.toContain('Dear Sandra')
    expect(html).not.toContain('A DISPATCH')
  })

  it('presents the three-step Board-to-Letterbox journey without inventing features', () => {
    expect(html).toContain('An interesting conversation')
    for (const text of ['Discover', 'Correspond', 'See where it leads', 'THE BOARD', 'THE LETTERBOX']) {
      expect(html).toContain(text)
    }
    expect(html).toContain('Some exchanges are brief.')
    expect(html).toContain('Others grow into correspondence you look forward to.')
    expect(html).not.toContain('A quiet week is still a good week.')
  })

  it('welcomes people who do not consider themselves writers', () => {
    expect(html).toContain("You don't have to be a writer")
    expect(html).toContain('It doesn\'t have to be clever or beautifully written.')
    expect(html).toContain('Come see who')
    expect(html).toContain('catches your attention.')
  })

  it('keeps working sign-in and join paths plus accessible navigation and legal links', () => {
    expect(html).toContain('href="/sign-in"')
    expect(html.match(/href="\/sign-in\?intent=join"/g)).toHaveLength(3)
    expect(html).toContain('href="#how-it-works"')
    expect(html).toContain('id="how-it-works"')
    expect(html).toContain('aria-label="Landing page navigation"')
    expect(html).toContain('aria-label="Legal links"')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/terms"')
    expect(html).not.toContain('href="/board"')
    expect(html).not.toContain('href="/welcome"')
  })
})
