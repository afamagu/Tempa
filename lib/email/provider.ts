import 'server-only'

export type SendEmailInput = {
  to: string
  subject: string
  html: string
  text: string
  /** Stable identifier for exactly this arrival event — e.g.
   * `letter-arrived/<letter_id>` (see lib/email/arrival-worker.ts).
   * Sent as Resend's `Idempotency-Key` header. MUST be the same value
   * on every retry of the same job — never regenerated per attempt —
   * so a request that Resend already accepted, but whose response this
   * process never saw (timeout, crash, network drop), retries into the
   * same accepted send rather than a second email reaching the
   * recipient. */
  idempotencyKey: string
}

export type SendEmailResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; error: string; retryable: boolean }

const REQUEST_TIMEOUT_MS = 10_000

/**
 * Resend's REST API directly (no SDK dependency) — a plain fetch POST,
 * which is also what keeps this trivially mockable in tests via
 * `globalThis.fetch`. Never called with a request that carries a
 * letter body, Moment, or Postcard — see lib/email/arrival.ts, the
 * only place that builds `html`/`text` for this system.
 *
 * `retryable` on failure distinguishes "try again later" (network
 * error, timeout, 429, 5xx) from "this will never succeed by retrying"
 * (4xx other than 429 — e.g. a malformed request or invalid recipient)
 * — the worker passes this straight through to
 * complete_arrival_email_job so a permanently-bad job fails fast
 * instead of exhausting the full backoff ladder first.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.ARRIVAL_EMAIL_FROM

  if (!apiKey || !from) {
    return { ok: false, error: 'RESEND_API_KEY and ARRIVAL_EMAIL_FROM are required.', retryable: false }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      const retryable = response.status === 429 || response.status >= 500
      return { ok: false, error: `Resend responded ${response.status}: ${body.slice(0, 200)}`, retryable }
    }

    const payload = (await response.json().catch(() => null)) as { id?: string } | null
    return { ok: true, providerMessageId: payload?.id ?? null }
  } catch (error) {
    // Includes AbortError from the timeout above — a hung request is
    // exactly as retryable as a network drop.
    const message = error instanceof Error ? error.message : 'Unknown provider error.'
    return { ok: false, error: message, retryable: true }
  } finally {
    clearTimeout(timeout)
  }
}
