export type SendEmailInput = {
  to: string
  subject: string
  html: string
  text: string
}

export type SendEmailResult = { ok: true } | { ok: false; error: string }

/**
 * Resend's REST API directly (no SDK dependency) — a plain fetch POST,
 * which is also what keeps this trivially mockable in tests via
 * `globalThis.fetch`. Never called with a request that carries a
 * letter body, Moment, or Postcard — see lib/email/arrival.ts, the
 * only place that builds `html`/`text` for this system.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.ARRIVAL_EMAIL_FROM

  if (!apiKey || !from) {
    return { ok: false, error: 'RESEND_API_KEY and ARRIVAL_EMAIL_FROM are required.' }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return { ok: false, error: `Resend responded ${response.status}: ${body.slice(0, 200)}` }
    }

    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown provider error.' }
  }
}
