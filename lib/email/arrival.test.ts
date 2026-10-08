import { describe, expect, it } from 'vitest'
import { renderArrivalEmail } from './arrival'

const base = {
  letterId: '75e131d5-f045-4d7f-b082-2db208d2e990',
  siteOrigin: 'https://jointempa.com',
}

describe('letter-arrival email', () => {
  it('keeps first contact anonymous while staying plainly transactional', () => {
    const message = renderArrivalEmail({
      ...base,
      firstContact: true,
      senderPseudonym: 'Evening Quill',
      senderCountryCode: 'ZA',
      artOrigin: 'https://jointempa.com/email/arrival-art',
    })

    expect(message.subject).toBe('A letter has arrived on Tempa')
    expect(message.html).toContain('Someone sent you a letter on Tempa.')
    expect(message.text).toContain('Someone sent you a letter on Tempa.')
    expect(message.html).not.toContain('Evening Quill')
    expect(message.text).not.toContain('Evening Quill')
    expect(message.html).toContain('Read your letter on Tempa')
    expect(message.html).not.toContain('<img')
    expect(message.html).not.toContain('arrival-art')
    expect(message.html).not.toContain('Cape Town')
    expect(message.html).not.toContain('Good letters take time')
  })

  it('uses a truthful generic fallback when the sender pseudonym is unavailable', () => {
    const message = renderArrivalEmail({ ...base, firstContact: true, senderPseudonym: null })
    expect(message.subject).toBe('A letter has arrived on Tempa')
    expect(message.html).toContain('Someone sent you a letter on Tempa.')
  })

  it('names an established correspondent without promotional artwork', () => {
    const message = renderArrivalEmail({
      ...base,
      firstContact: false,
      senderPseudonym: 'Quiet Harbor',
      senderCountryCode: 'JP',
      artOrigin: 'https://static.jointempa.com',
    })
    expect(message.subject).toBe('Quiet Harbor sent you a letter on Tempa')
    expect(message.html).toContain('Quiet Harbor sent you a letter on Tempa.')
    expect(message.html).not.toContain('<img')
  })

  it('escapes sender names in HTML while stripping control characters from the subject', () => {
    const message = renderArrivalEmail({
      ...base,
      firstContact: false,
      senderPseudonym: 'A <script>&\r\nBcc: outsider@example.com',
    })
    expect(message.subject).toBe('A <script>& Bcc: outsider@example.com sent you a letter on Tempa')
    expect(message.subject).not.toContain('\r')
    expect(message.subject).not.toContain('\n')
    expect(message.html).toContain('A &lt;script&gt;&amp; Bcc: outsider@example.com sent you a letter on Tempa.')
    expect(message.html).not.toContain('A <script>')
  })

  it('links directly to the delivered letter and notification settings', () => {
    const message = renderArrivalEmail({ ...base, firstContact: false, senderPseudonym: 'Maya' })
    expect(message.html).toContain('https://jointempa.com/letters/75e131d5-f045-4d7f-b082-2db208d2e990')
    expect(message.text).toContain('Read your letter on Tempa: https://jointempa.com/letters/75e131d5-f045-4d7f-b082-2db208d2e990')
    expect(message.html).toContain('/you/notifications#letter-arrivals')
  })

  it('does not include the letter body or imply that it does', () => {
    const message = renderArrivalEmail({ ...base, firstContact: true, senderPseudonym: 'Evening Quill' })
    expect(message.html).not.toContain('does not include the letter itself')
    expect(message.text).not.toContain('does not include the letter itself')
  })

  it('rejects unsafe site origins and invalid letter IDs', () => {
    expect(() => renderArrivalEmail({ ...base, firstContact: true, siteOrigin: 'http://jointempa.com' })).toThrow()
    expect(() => renderArrivalEmail({ ...base, firstContact: true, siteOrigin: 'https://jointempa.com/path' })).toThrow()
    expect(() => renderArrivalEmail({ ...base, firstContact: true, letterId: '../account' })).toThrow()
  })

  it('ignores legacy artwork inputs rather than turning an arrival notification into campaign mail', () => {
    const message = renderArrivalEmail({
      ...base,
      firstContact: true,
      senderPseudonym: 'Evening Quill',
      senderCountryCode: 'NG',
      artOrigin: 'http://legacy-art.example.test/path?tracking=1',
    })
    expect(message.html).not.toContain('legacy-art')
    expect(message.html).not.toContain('Nigeria')
    expect(message.html).not.toContain('<img')
  })
})
