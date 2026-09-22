import 'server-only'

export type SendEmailInput = {
  /** The exact From address to send with — sourced from the frozen
   * snapshot on a retry (see lib/email/arrival-worker.ts), never
   * re-read from env per attempt, so it stays part of the same stable
   * payload the idempotency key protects. */
  from: string
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
   * recipient. Resend also requires the REQUEST BODY to be identical
   * across retries of the same key — the caller is responsible for
   * that (see arrival-worker.ts's frozen-snapshot handling); this
   * module just sends exactly what it's given. */
  idempotencyKey: string
}

export type SendEmailResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; error: string; retryable: boolean }

const REQUEST_TIMEOUT_MS = 10_000
/** Resend error bodies are small JSON objects — bounding how much of
 * the raw response we ever parse or retain is defense in depth, not a
 * response to any specific observed payload size. */
const MAX_ERROR_BODY_CHARS = 2_000
const MAX_ERROR_MESSAGE_CHARS = 200

type ResendErrorBody = { name?: string; type?: string; code?: string; message?: string }

function parseResendErrorName(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText.slice(0, MAX_ERROR_BODY_CHARS)) as ResendErrorBody
    const name = (parsed.name || parsed.type || parsed.code || '').toLowerCase()
    return name || null
  } catch {
    return null
  }
}

/**
 * `retryable` classification for a non-2xx response:
 *   - 409 concurrent_idempotent_requests → retryable (another request
 *     with this exact key is already in flight at Resend; the normal
 *     backoff ladder gives it time to finish).
 *   - 409 invalid_idempotent_request → NOT retryable (Resend is
 *     reporting a payload mismatch against an existing idempotency
 *     key — retrying with the same, now-known-mismatched payload can
 *     only repeat the same conflict).
 *   - 409 with an unrecognized/unparseable body → NOT retryable
 *     (conservative default; an unrecognized conflict reason is
 *     exactly the kind of ambiguity this system is built to prefer a
 *     visible, human-reviewable stop over a blind retry loop for).
 *   - 429, 5xx → retryable.
 *   - any other 4xx → NOT retryable.
 */
function classifyRetryable(status: number, bodyText: string): boolean {
  if (status === 409) {
    return parseResendErrorName(bodyText) === 'concurrent_idempotent_requests'
  }
  if (status === 429) return true
  if (status >= 500) return true
  return false
}

function describeProviderError(status: number, bodyText: string): string {
  const truncated = bodyText.slice(0, MAX_ERROR_MESSAGE_CHARS)
  if (status === 409) {
    const name = parseResendErrorName(bodyText)
    if (name === 'invalid_idempotent_request') {
      return `Resend 409 invalid_idempotent_request (payload mismatch on an existing idempotency key — operationally visible, will not auto-retry): ${truncated}`
    }
    if (name === 'concurrent_idempotent_requests') {
      return `Resend 409 concurrent_idempotent_requests: ${truncated}`
    }
    return `Resend responded 409 with an unrecognized conflict reason — treated as non-retryable: ${truncated}`
  }
  return `Resend responded ${status}: ${truncated}`
}

/**
 * Resend's REST API directly (no SDK dependency) — a plain fetch POST,
 * which is also what keeps this trivially mockable in tests via
 * `globalThis.fetch`. Never called with a request that carries a
 * letter body, Moment, or Postcard — see lib/email/arrival.ts, the
 * only place that builds `html`/`text` for this system. Never logs or
 * returns more than a bounded slice of any provider response body, and
 * never includes the API key in any returned string — only the
 * `Authorization` header carries it.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey || !input.from) {
    return { ok: false, error: 'RESEND_API_KEY and a From address are required.', retryable: false }
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
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      return {
        ok: false,
        error: describeProviderError(response.status, bodyText),
        retryable: classifyRetryable(response.status, bodyText),
      }
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
