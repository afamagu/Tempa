// Safety 2 — the /api/safety/evaluate Route Handler's own contract,
// pulled out as a pure module so it can be unit-tested directly (no
// NextRequest/Supabase mocking needed for the parsing/mapping logic
// itself — app/api/safety/evaluate/route.test.ts covers the thin I/O
// wrapper separately).
//
// STRICT PER-SURFACE PARSING (per the approved architecture): the
// server owns the allowed surface names, each surface's exact required
// field, and what "context" means for that surface — never a generic
// client-controlled `surface + fields[]` interface that would let a
// caller invent an arbitrary surface or field bag. Only the three real
// Letter surfaces Checkpoint 3 will actually wire this into are
// accepted; see each surface's own comment below for where its
// required field comes from (app/write/[recipientId]/first-letter-
// composer.tsx, app/letters/[letterId]/first-contact-response.tsx,
// app/letters/[letterId]/moments-composer.tsx).

import type { ContentReasonCode, MutationDisposition } from './reason-codes'

export const SAFETY_SURFACES = ['first_letter', 'reply', 'write_anytime'] as const
export type SafetySurface = (typeof SAFETY_SURFACES)[number]

/** What the trusted recording RPC (public.record_safety_evaluation)
 * needs: a validated user id (from the authenticated session, NEVER
 * the request body), a known surface, that surface's own context id,
 * and the exact body text being classified. */
export type ParsedEvaluateRequest = {
  surface: SafetySurface
  contextId: string
  body: string
}

export type ParseEvaluateRequestResult =
  | { ok: true; request: ParsedEvaluateRequest }
  | { ok: false; error: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Generous abuse/DoS guard, deliberately not the Letter-1-only 2000-
// char anti-pestering cap (lib/questions.ts's QUESTION_ANSWER_MAX_CHARS)
// — that is a product rule the Letter RPCs themselves already enforce
// (and reply/write-anytime are explicitly NOT subject to it, per
// canSendLetter's own aboveMax handling), not a safety-classification
// concern. This just keeps an arbitrarily large payload from reaching
// the classifier at all.
const MAX_BODY_CHARS = 20_000

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function readBody(value: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof value !== 'string') {
    return { ok: false, error: 'body must be a string.' }
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: 'body must not be empty.' }
  }
  if (value.length > MAX_BODY_CHARS) {
    return { ok: false, error: 'body is too long.' }
  }
  return { ok: true, body: value }
}

export function parseEvaluateRequest(payload: unknown): ParseEvaluateRequestResult {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, error: 'Request body must be an object.' }
  }
  const fields = payload as Record<string, unknown>
  const surface = fields.surface

  if (surface === 'first_letter') {
    // Context = the recipient — matches send_first_letter's own
    // p_recipient_id (app/write/[recipientId]/first-letter-composer.tsx).
    if (!isUuid(fields.recipientId)) {
      return { ok: false, error: 'recipientId must be a UUID.' }
    }
    const bodyResult = readBody(fields.body)
    if (!bodyResult.ok) return bodyResult
    return { ok: true, request: { surface, contextId: fields.recipientId, body: bodyResult.body } }
  }

  if (surface === 'reply') {
    // Context = the letter being replied to — matches reply_to_letter's
    // own p_letter_id (app/letters/[letterId]/first-contact-response.tsx).
    if (!isUuid(fields.letterId)) {
      return { ok: false, error: 'letterId must be a UUID.' }
    }
    const bodyResult = readBody(fields.body)
    if (!bodyResult.ok) return bodyResult
    return { ok: true, request: { surface, contextId: fields.letterId, body: bodyResult.body } }
  }

  if (surface === 'write_anytime') {
    // Context = the correspondence — matches write_letter's own
    // p_correspondence_id (app/letters/[letterId]/moments-composer.tsx).
    if (!isUuid(fields.correspondenceId)) {
      return { ok: false, error: 'correspondenceId must be a UUID.' }
    }
    const bodyResult = readBody(fields.body)
    if (!bodyResult.ok) return bodyResult
    return { ok: true, request: { surface, contextId: fields.correspondenceId, body: bodyResult.body } }
  }

  return { ok: false, error: 'Unknown or missing surface.' }
}

/** The only thing returned to the browser about a mutation-disposition
 * decision — never the risk band, reason codes, or any extracted
 * indicator (see classify.ts's own ClassificationResult doc comment on
 * why those already stop at the server). */
export type MemberFacingDisposition = 'allow' | 'warning_required' | 'cannot_send'

export function toMemberFacingDisposition(mutationDisposition: MutationDisposition): MemberFacingDisposition {
  if (mutationDisposition === 'deny') return 'cannot_send'
  if (mutationDisposition === 'warn') return 'warning_required'
  return 'allow'
}

/** A single generic warning-copy key for Checkpoint 2 — deliberately
 * not a per-reason-code copy taxonomy yet (nothing downstream consumes
 * one, and reason codes themselves are never returned to the browser
 * to begin with). Extend this only once a real member-facing warning
 * UI (Checkpoint 3) needs to say something more specific. */
export const GENERIC_WARNING_COPY_KEY = 'safety_warning_generic'

export type EvaluateResponseBody = {
  evaluationId: string
  disposition: MemberFacingDisposition
  warningCopyKey?: string
}

export function buildEvaluateResponse(evaluationId: string, mutationDisposition: MutationDisposition): EvaluateResponseBody {
  const disposition = toMemberFacingDisposition(mutationDisposition)
  if (disposition === 'allow') {
    return { evaluationId, disposition }
  }
  return { evaluationId, disposition, warningCopyKey: GENERIC_WARNING_COPY_KEY }
}

// Re-exported only so route.ts has one import source for the request-
// side classifier types it needs to thread through to record_safety_
// evaluation's own parameters — not part of this module's own logic.
export type { ContentReasonCode }
