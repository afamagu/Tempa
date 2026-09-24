'use client'

// Safety 2, Checkpoint 3 — the one shared client-side gate every Letter
// composer (first-letter-composer.tsx, first-contact-response.tsx,
// moments-composer.tsx) now calls before its own mutation RPC, instead
// of calling send_first_letter/reply_to_letter/write_letter directly.
// Checkpoint 4 widens this to the public-text composers — dispatch-
// composer.tsx (publish and update), question-answer.tsx, reply-
// composer.tsx — same gate, same fail-closed guarantee, never a
// per-surface reimplementation.
//
// FAIL-CLOSED: if this call itself fails (network error, non-OK HTTP
// status, malformed response), the outcome is `'error'`, never
// `'allow'` — a composer must never treat "the Safety check itself
// broke" as "the Safety check passed." This is what makes "Safety API
// failure does not fall back to unscreened send" true structurally,
// not just by each composer separately remembering to check.
//
// The composer never sees a risk band, reason code, or any extracted
// indicator — only the coarse outcome this module already narrows
// evaluateSafety's own JSON response down to (see lib/safety/route-
// contract.ts's own EvaluateResponseBody doc comment for why the
// server itself already withholds those).

export type EvaluatePayload =
  | { surface: 'first_letter'; recipientId: string; questionAnswerId: string; body: string }
  | { surface: 'reply'; letterId: string; body: string }
  | {
      surface: 'write_anytime'
      correspondenceId: string
      body: string
      postcard?: { postcardKey: string; revealLine: string | null; backMessage: string } | null
    }
  | {
      surface: 'dispatch_publish'
      title: string
      topics: string[]
      body: string
      postcard?: { postcardKey: string; revealLine: string | null; backMessage: string } | null
    }
  | { surface: 'dispatch_update'; dispatchId: string; title: string; topics: string[]; body: string }
  | { surface: 'question_answer'; questionId: string; body: string }
  | { surface: 'dispatch_reply'; dispatchId: string; parentReplyId?: string | null; body: string }

export type EvaluateOutcome =
  | { status: 'allow'; evaluationId: string }
  | { status: 'warning_required'; evaluationId: string }
  | { status: 'cannot_send' }
  | { status: 'error' }

/** Calls /api/safety/evaluate and narrows its response to exactly what
 * a composer needs to decide what happens next. Any failure to reach
 * the server, a non-OK status, or a response that doesn't parse as
 * expected all become `'error'` — never silently treated as `'allow'`. */
export async function evaluateSafety(payload: EvaluatePayload): Promise<EvaluateOutcome> {
  let response: Response
  try {
    response = await fetch('/api/safety/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('[safety] evaluateSafety request threw', { message: err instanceof Error ? err.message : String(err) })
    return { status: 'error' }
  }

  if (!response.ok) {
    console.error('[safety] evaluateSafety returned a non-OK status', { status: response.status })
    return { status: 'error' }
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    return { status: 'error' }
  }

  if (typeof data !== 'object' || data === null) return { status: 'error' }
  const body = data as { evaluationId?: unknown; disposition?: unknown }
  if (typeof body.evaluationId !== 'string') return { status: 'error' }

  if (body.disposition === 'cannot_send') return { status: 'cannot_send' }
  if (body.disposition === 'warning_required') return { status: 'warning_required', evaluationId: body.evaluationId }
  if (body.disposition === 'allow') return { status: 'allow', evaluationId: body.evaluationId }
  return { status: 'error' }
}

/** Restrained, never-guilt-implying copy — shared by every composer so
 * the wording can never quietly drift apart between them. Never
 * mentions "scam"/"fraud"/risk band/reason codes; frames the warning as
 * a pause for the member's own benefit, not an accusation, per the
 * product's own explicit requirement.
 *
 * Checkpoint 4 — made surface-neutral ("what you've written", not "this
 * message") now that Dispatches and Question answers share this same
 * copy, rather than adding a per-surface accusation-language variant.
 * The final action button's own label stays per-surface (SafetyWarningDialog's
 * own actionLabel prop — "Publish anyway", "Save anyway", etc.). */
export const SAFETY_WARNING_TITLE = 'A moment before you continue'
export const SAFETY_WARNING_BODY =
  "What you've written includes something Tempa asks members to pause on before continuing — often it's nothing. You can look it over again, or continue as it is."
export const SAFETY_CANNOT_SEND_MESSAGE = "This can't be sent as written. Please take another look at what you've written."
/** Shown ONLY for `status: 'error'` — the Safety service itself failing
 * (network error, non-OK HTTP status, malformed response). Fail-closed:
 * nothing is sent. Deliberately says nothing about the member or their
 * writing — it is never used for a successful evaluation that resulted
 * in a warning or a `cannot_send`, which have their own copy above. */
export const SAFETY_CHECK_FAILED_MESSAGE =
  'We couldn’t complete the safety check right now. Please try again in a moment.'
