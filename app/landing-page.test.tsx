import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LandingPage from './landing-page'

describe('Ordinary letters landing page', () => {
  const html = renderToStaticMarkup(<LandingPage />)

  it('leads with the ordinary-day promise and a join action for mobile and desktop', () => {
    expect(html).toContain('Someone, somewhere, wrote about an')
    expect(html).toContain('ordinary day.')
    expect(html).toContain('If something in it stays with you, write them.')
    expect(html).toContain('Letters left in The Room.')
    expect(html).toContain('Founding Correspondents')
    expect(html).toContain('Tempa is currently invitation only.')
    expect(html.match(/I have an invitation/g)).toHaveLength(2)
    expect(html.match(/href="\/sign-in\?intent=join"/g)).toHaveLength(2)
    expect(html).toContain('href="#read"')
    expect(html).toContain('id="read"')
  })

  it('explains only the letter-to-correspondence path in four steps', () => {
    for (const title of ['Letters left here', 'You read', 'Write to them', 'A quiet pace']) {
      expect(html).toContain(title)
    }
    expect(html).toContain('If they write back, a correspondence begins.')
    expect(html).toContain('A quiet week is just a quiet week.')
  })

  it('illustrates ordinary writing without pretending these are verified member testimonials', () => {
    for (const text of ['Sunday lunch at two.', 'She knows which tea I buy.', 'My brother calls while I make dinner.']) {
      expect(html).toContain(text)
    }
    expect(html).toContain('Illustrative excerpts')
    expect(html).toContain('Illustrative letters')
    expect(html).not.toContain('The Dangerous Myth of Finding Your Calling')
    expect(html).not.toContain('A DISPATCH')
    expect(html).not.toContain('THIS WEEK’S QUESTION')
    expect(html).not.toContain('Send one with a letter or a Dispatch.')
  })

  it('preserves sign-in, accessible navigation, and legal links without fictional navigation controls', () => {
    expect(html).toContain('href="/sign-in"')
    expect(html).toContain('aria-label="Landing page navigation"')
    expect(html).toContain('aria-label="Legal links"')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/terms"')
    expect(html).not.toContain('href="/board"')
    expect(html).not.toContain('href="/dispatches"')
  })
})
