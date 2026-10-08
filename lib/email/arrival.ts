/** A letter arrival contains no letter body, Moment, or Postcard content. */
export type ArrivalEmailInput = {
  letterId: string
  firstContact: boolean
  senderPseudonym?: string | null
  /** Kept for worker compatibility. Arrival notifications deliberately do
   * not render location artwork: these are transactional mail, not campaigns. */
  senderCountryCode?: string | null
  /** Public HTTPS origin for Tempa, e.g. https://jointempa.com. */
  siteOrigin: string
  /** Kept for worker compatibility; deliberately ignored for arrival mail. */
  artOrigin?: string | null
}

export type RenderedArrivalEmail = {
  subject: string
  html: string
  text: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

function publicOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('An HTTPS site origin is required.')
  }
  return url.origin
}

function letterPath(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('A valid letter ID is required.')
  }
  return `/letters/${id}`
}

function cleanPseudonym(value?: string | null): string | null {
  const cleaned = value
    ?.replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80)
  return cleaned || null
}

/**
 * Transactional notification only. Deliberately avoids country artwork,
 * promotional sections, product taglines, or a newsletter-like layout.
 * Mail providers still control inbox categorisation; Tempa can only make the
 * message accurately resemble the person-to-person event it represents.
 */
export function renderArrivalEmail(input: ArrivalEmailInput): RenderedArrivalEmail {
  const origin = publicOrigin(input.siteOrigin)
  const href = `${origin}${letterPath(input.letterId)}`
  const settingsHref = `${origin}/you/notifications#letter-arrivals`
  const name = cleanPseudonym(input.senderPseudonym)

  // Preserve the existing first-contact privacy rule: the arrival email
  // does not identify a new sender before the recipient opens the letter.
  const establishedName = !input.firstContact ? name : null
  const subject = establishedName
    ? `${establishedName} wrote to you on Tempa`
    : 'You have a new letter on Tempa'
  const headline = 'You have a new letter.'
  const detail = input.firstContact
    ? 'Someone sent you a first letter on Tempa.'
    : establishedName
      ? `${establishedName} wrote to you on Tempa.`
      : 'A new letter is waiting in your Letterbox.'

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f7f3eb;color:#192e40"><table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" cellpadding="0" cellspacing="0" width="560" style="width:100%;max-width:560px;background:#fffcf6;border:1px solid #e3ddd1"><tr><td style="padding:26px 30px 12px;font:600 17px Georgia,serif;letter-spacing:0.10em">TEMPA</td></tr><tr><td style="padding:12px 30px 8px"><h1 style="font:normal 28px/1.25 Georgia,serif;color:#192e40;margin:0">${escapeHtml(headline)}</h1></td></tr><tr><td style="padding:8px 30px 22px;font:16px/1.55 Arial,sans-serif;color:#333b40">${escapeHtml(detail)}</td></tr><tr><td style="padding:0 30px 30px"><a href="${escapeHtml(href)}" style="display:inline-block;background:#192e40;color:#fff;text-decoration:none;border-radius:4px;padding:13px 18px;font:600 14px Arial,sans-serif">Open your letter</a></td></tr><tr><td style="border-top:1px solid #e3ddd1;padding:16px 30px 22px;font:12px/1.55 Arial,sans-serif;color:#686e72">This email only tells you that a letter arrived; it does not include the letter itself.<br><a href="${escapeHtml(settingsHref)}" style="color:#58646d">Letter-arrival notification settings</a></td></tr></table></td></tr></table></body></html>`
  const text = `TEMPA\n\n${headline}\n\n${detail}\n\nOpen your letter: ${href}\n\nThis email only tells you that a letter arrived; it does not include the letter itself.\nLetter-arrival notification settings: ${settingsHref}`

  return { subject, html, text }
}
