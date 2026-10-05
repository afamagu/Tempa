export type ReplyReminderEmailInput = {
  letterId: string
  counterpartPseudonym?: string | null
  rhythmLabel?: string | null
  siteOrigin: string
}

export type RenderedReplyReminderEmail = {
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

function safeHeaderName(value?: string | null): string | null {
  const normalized = value
    ?.replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80)
  return normalized || null
}

/**
 * A deliberately low-pressure reminder. It contains no Letter body, Moment,
 * Postcard, elapsed-day counter or "overdue" language. The member explicitly
 * asked Tempa to send it; the email merely brings them back to the waiting
 * letter without turning their writing rhythm into a deadline.
 */
export function renderReplyReminderEmail(input: ReplyReminderEmailInput): RenderedReplyReminderEmail {
  const origin = publicOrigin(input.siteOrigin)
  const href = `${origin}${letterPath(input.letterId)}`
  const name = safeHeaderName(input.counterpartPseudonym)
  const subject = 'A quiet reminder from Tempa'
  const headline = name ? `${name}'s letter is still waiting.` : 'A letter is still waiting for you.'
  const rhythm = input.rhythmLabel?.trim().slice(0, 80)
  const detail = rhythm
    ? `You asked Tempa to remind you when a waiting letter passed your writing rhythm (${rhythm}). There is no deadline here.`
    : 'You asked Tempa to remind you when a waiting letter passed your writing rhythm. There is no deadline here.'

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f7f3eb;color:#192e40"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f7f3eb"><tr><td align="center" style="padding:24px 12px"><table role="presentation" cellpadding="0" cellspacing="0" width="600" style="width:100%;max-width:600px;background:#fffcf6;border:1px solid #e3ddd1"><tr><td style="padding:26px 30px 22px;font:600 19px Georgia,serif;letter-spacing:0.12em">TEMPA</td></tr><tr><td style="padding:30px 30px 8px"><h1 style="font:normal 30px/1.25 Georgia,serif;color:#192e40;margin:0">${escapeHtml(headline)}</h1></td></tr><tr><td style="padding:10px 30px 12px;font:16px/1.55 Arial,sans-serif;color:#333b40">${escapeHtml(detail)}</td></tr><tr><td style="padding:0 30px 20px;font:15px/1.55 Arial,sans-serif;color:#585e61">Good letters take time. This is the one reminder you asked for, not a countdown.</td></tr><tr><td style="padding:0 30px 36px"><a href="${escapeHtml(href)}" style="display:inline-block;background:#192e40;color:#fff;text-decoration:none;border-radius:4px;padding:15px 22px;font:600 15px Arial,sans-serif">Return to your letter</a></td></tr><tr><td style="border-top:1px solid #e3ddd1;padding:19px 30px 25px;font:12px/1.5 Arial,sans-serif;color:#585e61">You can change reply reminders under You → Notifications.<br><a href="${escapeHtml(origin)}/you/notifications" style="color:#585e61">Notification settings</a></td></tr></table></td></tr></table></body></html>`

  const text = `TEMPA\n\n${headline}\n\n${detail}\n\nGood letters take time. This is the one reminder you asked for, not a countdown.\n\nReturn to your letter: ${href}\n\nNotification settings: ${origin}/you/notifications`

  return { subject, html, text }
}
