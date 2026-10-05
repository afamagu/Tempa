import { describe, expect, it } from 'vitest'
import { renderReplyReminderEmail } from './reply-reminder'

const LETTER_ID = '795d3677-06de-4f59-b471-4bb06d65bce7'

describe('reply reminder email', () => {
  it('stays quiet, private and deep-links to the waiting letter', () => {
    const rendered = renderReplyReminderEmail({
      letterId: LETTER_ID,
      counterpartPseudonym: 'Evening Quill',
      rhythmLabel: 'About a week',
      siteOrigin: 'https://jointempa.com',
    })

    expect(rendered.subject).toBe('A quiet reminder from Tempa')
    expect(rendered.text).toContain("Evening Quill's letter is still waiting.")
    expect(rendered.text).toContain('There is no deadline here.')
    expect(rendered.text).toContain(`https://jointempa.com/letters/${LETTER_ID}`)
    expect(rendered.text.toLowerCase()).not.toContain('overdue')
    expect(rendered.text.toLowerCase()).not.toContain('late')
  })

  it('sanitizes a pseudonym before it can influence an email header-adjacent surface', () => {
    const rendered = renderReplyReminderEmail({
      letterId: LETTER_ID,
      counterpartPseudonym: 'A\r\nB',
      siteOrigin: 'https://jointempa.com',
    })

    expect(rendered.html).toContain("A B's letter is still waiting.")
    expect(rendered.html).not.toContain('\r')
    expect(rendered.html).not.toContain('\nB')
  })

  it('rejects a non-HTTPS or path-bearing site origin', () => {
    expect(() => renderReplyReminderEmail({
      letterId: LETTER_ID,
      siteOrigin: 'http://jointempa.com',
    })).toThrow()

    expect(() => renderReplyReminderEmail({
      letterId: LETTER_ID,
      siteOrigin: 'https://jointempa.com/sneaky',
    })).toThrow()
  })
})
