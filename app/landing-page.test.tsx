import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LandingPage from './landing-page'

describe('Tempa pen pals restored landing page', () => {
  const html = renderToStaticMarkup(<LandingPage />)

  it('leads with pen pals, ordinary days, and the promise of writing to a person', () => {
    expect(html).toContain('Pen pals restored.')
    expect(html).toContain('Write to someone about an ordinary day.')
    expect(html).toContain('If something in it stays with you, write them.')
    expect(html).toContain('You meet someone through what they wrote, not through a photo or a profile.')
    expect(html).toContain('Tempa is a place for pen pals. Real letters, not messages that expect a reply tonight.')
    expect(html).toContain('No followers. No feed to keep up with. Just letters.')
    expect(html).not.toContain('People are easy to find.')
    expect(html).not.toContain('invitation only')
  })

  it('explains The Board and pen-pal correspondence in exactly three concise steps', () => {
    for (const title of [
      'Leave a letter or find one',
      'Write when you have something to say',
      'They write back, or they don’t',
    ]) {
      expect(html).toContain(title)
    }
    expect(html.match(/class="[^"]*stepNumber[^"]*"/g)).toHaveLength(3)
    expect(html).toContain('Leave a letter on The Board.')
    expect(html).toContain('Someone, somewhere, might find something in your words')
    expect(html).toContain('Or look for someone by place or language')
    expect(html).toContain('Write when you are ready. A quiet week is a pace, not a disappearance.')
    expect(html).toContain('A reply begins the correspondence.')
    expect(html).toContain('You can send a postcard with your letter if you want.')
    expect(html).toContain('The letter is the main thing.')
    expect(html).not.toContain('The Room')
  })

  it('preserves the clear closing invitation and the existing illustrative letter', () => {
    expect(html).toContain('Someone, somewhere, wrote about an ordinary day.')
    expect(html).toContain('LETTER LEFT ON THE BOARD')
    expect(html).toContain('Illustrative letters')
    expect(html).toContain('— Sandra')
    expect(html).toContain('Toronto, Canada')
    expect(html).toContain('Dear Sandra,')
    expect(html).not.toContain('Adaeze')
    expect(html).not.toContain('A DISPATCH')
  })

  it('keeps public signup, navigation, legal routes and both join buttons intact', () => {
    expect(html).toContain('href="/sign-in"')
    expect(html).toContain('aria-label="Landing page navigation"')
    expect(html).toContain('href="#read"')
    expect(html).toContain('id="read"')
    expect(html.match(/>Enter Tempa/g)).toHaveLength(2)
    expect(html.match(/href="\/sign-in\?intent=join"/g)).toHaveLength(2)
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/terms"')
    expect(html).not.toContain('href="/board"')
    expect(html).not.toContain('href="/dispatches"')
  })
})
