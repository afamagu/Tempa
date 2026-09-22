import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { ORIGIN_ARRIVAL_ART, renderArrivalEmail } from './arrival'

const ARRIVAL_ART_DIR = path.join(__dirname, '..', '..', 'public', 'email', 'arrival-art')

const base = {
  letterId: '75e131d5-f045-4d7f-b082-2db208d2e990',
  siteOrigin: 'https://jointempa.com',
}

describe('letter-arrival email', () => {
  it('keeps first contact anonymous in the subject and body, with a working action when artwork is blocked', () => {
    const message = renderArrivalEmail({ ...base, firstContact: true, senderPseudonym: 'Evening Quill', senderCountryCode: 'ZA' })
    expect(message.subject).toBe('A letter has arrived for you')
    expect(message.html).not.toContain('Evening Quill')
    expect(message.text).not.toContain('Evening Quill')
    expect(message.html).not.toContain('<img')
    expect(message.html).toContain('https://jointempa.com/letters/75e131d5-f045-4d7f-b082-2db208d2e990')
    expect(message.text).toContain('Open your letter:')
  })

  it('escapes established sender names and treats country artwork as optional decoration', () => {
    const message = renderArrivalEmail({ ...base, firstContact: false, senderPseudonym: 'A <script>&', senderCountryCode: 'th', artOrigin: 'https://static.jointempa.com' })
    expect(message.html).toContain('A &lt;script&gt;&amp;')
    expect(message.html).toContain('02-bangkok-thailand.jpg')
    expect(message.html).toContain('alt=""')
    expect(message.text).not.toContain('Bangkok')
  })

  it('a bare root artOrigin (no pathname) still works exactly as before', () => {
    const message = renderArrivalEmail({ ...base, firstContact: false, senderCountryCode: 'ZA', artOrigin: 'https://static.jointempa.com' })
    expect(message.html).toContain('src="https://static.jointempa.com/32-cape-town-south-africa.jpg"')
  })

  it('accepts a pathname-bearing art base URL and produces the exact expected image URL — ZA', () => {
    const message = renderArrivalEmail({
      ...base,
      firstContact: false,
      senderCountryCode: 'ZA',
      artOrigin: 'https://jointempa.com/email/arrival-art',
    })
    expect(message.html).toContain('src="https://jointempa.com/email/arrival-art/32-cape-town-south-africa.jpg"')
  })

  it('accepts a pathname-bearing art base URL and produces the exact expected image URL — NG', () => {
    const message = renderArrivalEmail({
      ...base,
      firstContact: false,
      senderCountryCode: 'NG',
      artOrigin: 'https://jointempa.com/email/arrival-art',
    })
    expect(message.html).toContain('src="https://jointempa.com/email/arrival-art/35-lagos-nigeria.jpg"')
  })

  it('a trailing slash on the art base URL produces the identical image URL as no trailing slash', () => {
    const withSlash = renderArrivalEmail({
      ...base,
      firstContact: false,
      senderCountryCode: 'ZA',
      artOrigin: 'https://jointempa.com/email/arrival-art/',
    })
    const withoutSlash = renderArrivalEmail({
      ...base,
      firstContact: false,
      senderCountryCode: 'ZA',
      artOrigin: 'https://jointempa.com/email/arrival-art',
    })
    const extractSrc = (html: string) => html.match(/src="([^"]+)"/)?.[1]
    expect(extractSrc(withSlash.html)).toBe('https://jointempa.com/email/arrival-art/32-cape-town-south-africa.jpg')
    expect(extractSrc(withSlash.html)).toBe(extractSrc(withoutSlash.html))
  })

  it('missing artOrigin omits the image entirely without breaking the rest of the email', () => {
    const message = renderArrivalEmail({ ...base, firstContact: false, senderPseudonym: 'Evening Quill', senderCountryCode: 'ZA' })
    expect(message.html).not.toContain('<img')
    expect(message.html).toContain('Evening Quill')
    expect(message.html).toContain('https://jointempa.com/letters/75e131d5-f045-4d7f-b082-2db208d2e990')
  })

  it('rejects unsafe URLs and IDs', () => {
    expect(() => renderArrivalEmail({ ...base, firstContact: true, siteOrigin: 'http://jointempa.com' })).toThrow()
    expect(() => renderArrivalEmail({ ...base, firstContact: true, letterId: '../account' })).toThrow()
    expect(() => renderArrivalEmail({ ...base, firstContact: true, senderCountryCode: 'ZA', artOrigin: 'https://evil.test/?tracking=1' })).toThrow()
  })

  it('the art base URL still rejects insecure HTTP', () => {
    expect(() =>
      renderArrivalEmail({ ...base, firstContact: true, senderCountryCode: 'ZA', artOrigin: 'http://jointempa.com/email/arrival-art' })
    ).toThrow()
  })

  it('the art base URL still rejects a query string, including on a pathname-bearing base', () => {
    expect(() =>
      renderArrivalEmail({ ...base, firstContact: true, senderCountryCode: 'ZA', artOrigin: 'https://jointempa.com/email/arrival-art?tracking=1' })
    ).toThrow()
  })

  it('the art base URL still rejects a fragment', () => {
    expect(() =>
      renderArrivalEmail({ ...base, firstContact: true, senderCountryCode: 'ZA', artOrigin: 'https://jointempa.com/email/arrival-art#section' })
    ).toThrow()
  })

  it('the art base URL still rejects embedded credentials', () => {
    expect(() =>
      renderArrivalEmail({ ...base, firstContact: true, senderCountryCode: 'ZA', artOrigin: 'https://user:pass@jointempa.com/email/arrival-art' })
    ).toThrow()
  })

  it('the deep-link siteOrigin remains strict/root-only — a pathname is still rejected there, unlike artOrigin', () => {
    expect(() => renderArrivalEmail({ ...base, firstContact: true, siteOrigin: 'https://jointempa.com/some/path' })).toThrow()
  })

  it('does not permit a pseudonym to add mail headers', () => {
    const message = renderArrivalEmail({ ...base, firstContact: false, senderPseudonym: 'Maya\r\nBcc: outsider@example.com' })
    expect(message.subject).toBe('A letter from Maya Bcc: outsider@example.com has arrived')
    expect(message.subject).not.toContain('\r')
    expect(message.subject).not.toContain('\n')
  })

  it('maps each of the 35 country codes to one unique named asset', () => {
    expect(Object.keys(ORIGIN_ARRIVAL_ART)).toHaveLength(35)
    expect(new Set(Object.values(ORIGIN_ARRIVAL_ART)).size).toBe(35)
  })

  it('every mapped asset filename actually exists under public/email/arrival-art/', () => {
    const missing = Object.entries(ORIGIN_ARRIVAL_ART).filter(
      ([, filename]) => !existsSync(path.join(ARRIVAL_ART_DIR, filename))
    )
    expect(missing).toEqual([])
  })
})
