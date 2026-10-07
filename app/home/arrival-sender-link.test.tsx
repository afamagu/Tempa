import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ArrivalSenderLink from './arrival-sender-link'

describe('ArrivalSenderLink', () => {
  it('Mark + pseudonym are ONE link to that sender\'s public profile', () => {
    const html = renderToStaticMarkup(<ArrivalSenderLink senderId="user-1" pseudonym="Evening Quill" />)
    const anchorCount = (html.match(/<a /g) ?? []).length
    expect(anchorCount).toBe(1)
    expect(html).toContain('href="/room/user-1"')
    expect(html).toContain('Evening Quill')
  })

  it('never links to a write composer or answer-specific route', () => {
    const html = renderToStaticMarkup(<ArrivalSenderLink senderId="user-2" pseudonym="Saint Nico" />)
    expect(html).not.toContain('/write/')
    expect(html).not.toContain('view=answer')
  })
})
