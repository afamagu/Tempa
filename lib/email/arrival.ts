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
 * Transactional notification only. Deliberately plain: no location art,
 * hero card, marketing tagline, or promotional button treatment. Mail
 * providers still decide inbox categorisation; Tempa can only make the
 * message accurately resemble the person-to-person event it represents.
 */
export function renderArrivalEmail(input: ArrivalEmailInput): RenderedArrivalEmail {
  const origin = publicOrigin(input.siteOrigin)
  const href = `${origin}${letterPath(input.letterId)}`
  const settingsHref = `${origin}/you/notifications#letter-arrivals`
  const name = cleanPseudonym(input.senderPseudonym)

  // Preserve first-contact privacy until the recipient opens the letter.
  const establishedName = !input.firstContact ? name : null
  const subject = establishedName
    ? `${establishedName} sent you a letter on Tempa`
    : 'A letter has arrived on Tempa'
  const detail = input.firstContact
    ? 'Someone sent you a letter on Tempa.'
    : establishedName
      ? `${establishedName} sent you a letter on Tempa.`
      : 'A letter has arrived in your Tempa Letterbox.'

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:24px;font:16px/1.6 Arial,sans-serif;color:#222;background:#fff"><p style="margin:0 0 16px">${escapeHtml(detail)}</p><p style="margin:0 0 20px"><a href="${escapeHtml(href)}" style="color:#192e40">Read your letter on Tempa</a></p><p style="margin:0;font-size:12px;color:#666">You can change letter-arrival notifications in <a href="${escapeHtml(settingsHref)}" style="color:#666">Tempa notification settings</a>.</p></body></html>`
  const text = `${detail}\n\nRead your letter on Tempa: ${href}\n\nChange letter-arrival notifications: ${settingsHref}`

  return { subject, html, text }
}
