import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MailOnTheWay from './mail-on-the-way'

describe('MailOnTheWay — private travelling-letter notice', () => {
  it('resolves the approved decorative travelling-envelope asset', () => {
    const html = renderToStaticMarkup(<MailOnTheWay />)
    expect(html).toContain(`url=${encodeURIComponent('/brand/mail-on-the-way.png')}`)
  })

  it('keeps the asset decorative so the live status copy is announced instead', () => {
    const html = renderToStaticMarkup(<MailOnTheWay />)
    const imgIndex = html.indexOf('<img')
    expect(imgIndex).toBeGreaterThan(-1)
    const imgTagEnd = html.indexOf('>', imgIndex)
    const imgTag = html.slice(imgIndex, imgTagEnd)
    expect(imgTag).toContain('alt=""')
    expect(imgTag.toLowerCase()).toContain('aria-hidden="true"')
  })

  it('uses the approved relationship-first status wording as live text', () => {
    const html = renderToStaticMarkup(<MailOnTheWay />)
    expect(html).toContain('A letter is on the way')
    expect(html).toContain('It hasn&#x27;t arrived yet.')
    expect(html).not.toContain('Mail on the way')
    const imgIndex = html.indexOf('<img')
    const imgTagEnd = html.indexOf('>', imgIndex)
    expect(html.slice(imgIndex, imgTagEnd)).not.toContain('A letter is on the way')
  })

  it('never turns ordinary transit into an alert', () => {
    const html = renderToStaticMarkup(<MailOnTheWay />)
    expect(html).not.toContain('Status:')
    expect(html.toLowerCase()).not.toMatch(/bg-red|bg-destructive|role="alert"/)
  })

  it('accepts an optional className for layout placement by the caller', () => {
    const html = renderToStaticMarkup(<MailOnTheWay className="mt-2" />)
    expect(html).toMatch(/class="[^"]*mt-2[^"]*"/)
  })
})
