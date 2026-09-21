import { describe, expect, it } from 'vitest'
import { ORIGIN_ARRIVAL_ART, renderArrivalEmail } from './arrival'

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

  it('rejects unsafe URLs and IDs', () => {
    expect(() => renderArrivalEmail({ ...base, firstContact: true, siteOrigin: 'http://jointempa.com' })).toThrow()
    expect(() => renderArrivalEmail({ ...base, firstContact: true, letterId: '../account' })).toThrow()
    expect(() => renderArrivalEmail({ ...base, firstContact: true, senderCountryCode: 'ZA', artOrigin: 'https://evil.test/?tracking=1' })).toThrow()
  })

  it('maps each of the 35 country codes to one unique named asset', () => {
    expect(Object.keys(ORIGIN_ARRIVAL_ART)).toHaveLength(35)
    expect(new Set(Object.values(ORIGIN_ARRIVAL_ART)).size).toBe(35)
  })
})
