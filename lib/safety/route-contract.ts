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
// caller invent an arbitrary surface or field bag. Checkpoint 4 widens
// this from the three Letter surfaces to the public-text surfaces —
// dispatch_publish, dispatch_update, question_answer, dispatch_reply
// (app/board/dispatch-composer.tsx, app/question/question-answer.tsx,
// app/board/[dispatchId]/reply-composer.tsx) — same discipline, never a
// generic surface.

import type { ContentReasonCode, MutationDisposition } from './reason-codes'
import { QUESTION_ANSWER_MAX_CHARS } from '@/lib/questions'
import { TITLE_MAX_CHARS, TOPIC_MAX_CHARS, TOPIC_MAX_COUNT, normalizeTopics } from '@/lib/dispatches'
import { REPLY_MAX_CHARS } from '@/lib/replies'

export const SAFETY_SURFACES = [
  'first_letter',
  'reply',
  'write_anytime',
  'dispatch_publish',
  'dispatch_update',
  'question_answer',
  'dispatch_reply',
] as const
export type SafetySurface = (typeof SAFETY_SURFACES)[number]

/** The exact optional Postcard shape write_letter/reply_to_letter's own
 * p_postcard jsonb actually accepts (postcard_key/reveal_line/
 * back_message) — camelCase here at the TS boundary, translated to
 * snake_case only where the Route Handler builds the actual RPC/jsonb
 * payload (app/api/safety/evaluate/route.ts), never renamed elsewhere,
 * so the same object shape a composer already builds for its own
 * mutation call can be reused for evaluation with no extra mapping. */
export type ParsedPostcard = {
  postcardKey: string
  revealLine: string | null
  backMessage: string
}

/** What the trusted recording RPC (public.record_safety_evaluation)
 * needs: a validated user id (from the authenticated session, NEVER
 * the request body), a known surface, that surface's own context id,
 * the exact body text being classified, and — for first_letter only —
 * the specific Question-answer (Discovery entry) the letter is actually
 * addressed from, matching send_first_letter's own p_question_answer_id.
 * context_id alone (the recipient, for first_letter) is not specific
 * enough to bind an evaluation to the real mutation context — a forged
 * or stale Question-answer for an otherwise-legitimate recipient must
 * still be rejected. Always null for reply/write_anytime, which have no
 * Question-answer at all.
 *
 * postcard: the optional Postcard reply/write_anytime may carry —
 * always null for first_letter, which structurally has none (never even
 * parsed for that surface). Bound into the SQL fingerprint exactly like
 * body (docs/sql/2026-10-03-safety-persistence.sql's own
 * tempa_private.safety_fingerprint), so a Postcard's user-written
 * Reveal Line/back message get the same "changing it after evaluation
 * requires a fresh evaluation" guarantee the body already has, and are
 * classified alongside the body (never blindly concatenated with it —
 * see lib/safety/classify.ts's own combineClassifications). */
/** Checkpoint 4 — dispatch_publish has no pre-existing Dispatch id at
 * evaluation time (the Dispatch does not exist yet). Rather than invent
 * a schema concept for a no-existing-target creation surface, this
 * surface's context is the authenticated member's own identity, derived
 * SERVER-SIDE from the session (never client-supplied) — see route.ts's
 * own handler, which fills contextId in from user.id after parsing.
 * null here means exactly that: "not yet known, to be derived", never
 * "no context requirement at all." Every other surface always parses
 * its own real, client-supplied (but UUID-shaped) target id. */
export type ParsedEvaluateRequest = {
  surface: SafetySurface
  contextId: string | null
  /** dispatch_reply only — the optional parent Reply being answered.
   * null for a top-level Reply and for every non-dispatch_reply
   * surface. Bound into the fingerprint as its own field (never folded
   * into contextId), matching can_evaluate_safety_context's own
   * secondary_context_id parameter (docs/sql/2026-10-03-safety-
   * persistence.sql) — changing the parent target after evaluation
   * must invalidate clearance exactly like any other bound field. */
  secondaryContextId: string | null
  questionAnswerId: string | null
  /** dispatch_publish/dispatch_update only — classified and
   * fingerprinted independently from body (never concatenated), same
   * pattern as postcard's own fields. null for every other surface. */
  title: string | null
  /** dispatch_publish/dispatch_update only — normalizeTopics(input)'s
   * own output (lib/dispatches.ts), the SAME canonical normalization
   * publish_dispatch/update_dispatch perform server-side, so the
   * classified/fingerprinted topics are guaranteed to match what the
   * real mutation will actually save. null for every other surface. */
  topics: string[] | null
  postcard: ParsedPostcard | null
  body: string
}

export type ParseEvaluateRequestResult =
  | { ok: true; request: ParsedEvaluateRequest }
  | { ok: false; error: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A technical request-abuse ceiling only — deliberately NOT the
// Letter-1-only 2000-char anti-pestering cap (lib/questions.ts's
// QUESTION_ANSWER_MAX_CHARS). That is a PRODUCT rule the Letter RPCs
// themselves already enforce, and reply/write-anytime are explicitly
// NOT subject to it (canSendLetter's own `aboveMax: false` hardcoding
// for those two surfaces — see first-contact-response.tsx/moments-
// composer.tsx) precisely because an established correspondence has no
// such limit. This endpoint must support everything those established
// mutation paths legitimately support: neither the real Letter RPCs
// (write_letter/reply_to_letter, which store the body in an ordinary
// unbounded `text` column) nor this app's own client-side composers
// impose any character cap on reply/write-anytime content. 200,000
// characters is generous well past any realistic letter (tens of
// thousands of words) while still bounding a deliberately abusive
// payload from reaching the classifier at all — it is not, and must
// never quietly become, a new smaller Tempa Letter limit.
const MAX_BODY_CHARS = 200_000

// first_letter's own product cap — independent audit correction. Unlike
// the generic MAX_BODY_CHARS abuse ceiling above (deliberately NOT a
// product rule, see its own comment), this IS the real product rule
// send_first_letter now enforces server-side, and first-letter-
// composer.tsx enforces client-side — the SAME canonical constant, so
// the three can never silently drift apart. Because a meaningful/high/
// severe evaluation creates a signal/case independent of whether any
// mutation ever happens, a first_letter body the real RPC could never
// accept must not be allowed to reach classification/recording at all.
const FIRST_LETTER_MAX_CHARS = QUESTION_ANSWER_MAX_CHARS

// Modest TECHNICAL ceilings only — deliberately NOT the exact product
// rules (Reveal Line <= 32, an active postcard_key) the real mutation
// RPCs and tempa_private.postcard_shape_is_valid (docs/sql/2026-10-03-
// safety-persistence.sql) already enforce authoritatively. Re-deriving
// those exact numbers here would be a second, independent product-rule
// implementation that could silently drift from the SQL one — these
// exist only to stop a genuinely abusive payload (kilobytes of text in
// a field that's really a short catalog key/one-line caption) from ever
// reaching the classifier or the database, same reasoning as MAX_BODY_
// CHARS itself.
const POSTCARD_KEY_MAX_CHARS = 200
const REVEAL_LINE_MAX_CHARS = 500

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/** Unicode code-point count, matching first-letter-composer.tsx's own
 * charLength exactly (Array.from(text).length) — NOT JS's plain
 * `.length` (UTF-16 code units), which would diverge from that on
 * supplementary-plane characters. Postgres's own char_length() (what
 * send_first_letter's server-side cap actually uses) counts the same
 * way for the same content, so this is the one counting method that
 * agrees with both the client and the real mutation RPC. */
function codePointLength(text: string): number {
  return Array.from(text).length
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

/** first_letter only — readBody's own generic abuse ceiling first, then
 * the real Letter-1 product cap (2,000 characters, code-point-counted —
 * see codePointLength's own doc comment), matching send_first_letter's
 * server-side check and first-letter-composer.tsx's client-side one
 * exactly. */
function readFirstLetterBody(value: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const bodyResult = readBody(value)
  if (!bodyResult.ok) return bodyResult
  if (codePointLength(bodyResult.body) > FIRST_LETTER_MAX_CHARS) {
    return { ok: false, error: 'body is too long for a first letter.' }
  }
  return bodyResult
}

/** Optional — undefined/null means "no Postcard", the ordinary case for
 * most reply/write_anytime evaluations. When present, only shape-
 * validates with modest TECHNICAL ceilings (non-empty postcardKey/
 * backMessage, each field bounded by its own generous ceiling above);
 * the actual PRODUCT limits (Reveal Line <= 32 chars, back message
 * <= 300 chars, an active postcard_key, a current version) are enforced
 * authoritatively in exactly one place — tempa_private.
 * postcard_shape_is_valid (docs/sql/2026-10-03-safety-persistence.sql),
 * called from can_evaluate_safety_context before an evaluation is ever
 * persisted, and the real mutation RPCs themselves — never re-derived
 * here, which would risk silently drifting from either. */
function readPostcard(value: unknown): { ok: true; postcard: ParsedPostcard | null } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, postcard: null }
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'postcard must be an object.' }
  }
  const fields = value as Record<string, unknown>

  if (typeof fields.postcardKey !== 'string' || fields.postcardKey.trim().length === 0) {
    return { ok: false, error: 'postcard.postcardKey must be a non-empty string.' }
  }
  if (fields.postcardKey.length > POSTCARD_KEY_MAX_CHARS) {
    return { ok: false, error: 'postcard.postcardKey is too long.' }
  }

  let revealLine: string | null = null
  if (fields.revealLine !== undefined && fields.revealLine !== null) {
    if (typeof fields.revealLine !== 'string') {
      return { ok: false, error: 'postcard.revealLine must be a string or null.' }
    }
    if (fields.revealLine.length > REVEAL_LINE_MAX_CHARS) {
      return { ok: false, error: 'postcard.revealLine is too long.' }
    }
    revealLine = fields.revealLine
  }

  if (typeof fields.backMessage !== 'string' || fields.backMessage.trim().length === 0) {
    return { ok: false, error: 'postcard.backMessage must be a non-empty string.' }
  }
  if (fields.backMessage.length > MAX_BODY_CHARS) {
    return { ok: false, error: 'postcard.backMessage is too long.' }
  }

  return { ok: true, postcard: { postcardKey: fields.postcardKey, revealLine, backMessage: fields.backMessage } }
}

/** dispatch_publish/dispatch_update only — mirrors dispatchTitleError
 * (lib/dispatches.ts) exactly, the same canonical TITLE_MAX_CHARS
 * publish_dispatch/update_dispatch themselves enforce server-side. */
function readTitle(value: unknown): { ok: true; title: string } | { ok: false; error: string } {
  if (typeof value !== 'string') {
    return { ok: false, error: 'title must be a string.' }
  }
  if (value.trim().length === 0) {
    return { ok: false, error: 'title must not be empty.' }
  }
  if (value.length > TITLE_MAX_CHARS) {
    return { ok: false, error: 'title is too long.' }
  }
  return { ok: true, title: value }
}

/** dispatch_publish/dispatch_update only — normalizeTopics (lib/
 * dispatches.ts) IS the one canonical normalization, reused here
 * unmodified so the topics this endpoint classifies/fingerprints are
 * guaranteed to match what publish_dispatch/update_dispatch will
 * actually save — never a second, independently maintained
 * implementation. A missing topics field is treated as an empty list
 * (matches the real RPCs' own `default '{}'`), not an error. */
function readTopics(value: unknown): { ok: true; topics: string[] } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, topics: [] }
  }
  if (!Array.isArray(value) || !value.every((t) => typeof t === 'string')) {
    return { ok: false, error: 'topics must be an array of strings.' }
  }
  if (value.length > TOPIC_MAX_COUNT) {
    return { ok: false, error: 'too many topics.' }
  }
  for (const topic of value) {
    if (topic.length > TOPIC_MAX_CHARS * 4) {
      // Modest technical ceiling only, well above TOPIC_MAX_CHARS —
      // normalizeTopics itself clips to TOPIC_MAX_CHARS below; this
      // only stops a genuinely abusive single-topic payload from ever
      // reaching the classifier.
      return { ok: false, error: 'a topic is too long.' }
    }
  }
  return { ok: true, topics: normalizeTopics(value) }
}

/** dispatch_reply only — mirrors replyBodyError (lib/replies.ts)
 * exactly, the same canonical REPLY_MAX_CHARS create_reply itself
 * enforces server-side. Not readFirstLetterBody's FIRST_LETTER_MAX_
 * CHARS (a different, unrelated product cap) and not the generic
 * MAX_BODY_CHARS abuse ceiling alone (which would let a Reply far
 * longer than the real mutation could ever accept reach the
 * classifier/database). */
function readReplyBody(value: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const bodyResult = readBody(value)
  if (!bodyResult.ok) return bodyResult
  if (bodyResult.body.trim().length > REPLY_MAX_CHARS) {
    return { ok: false, error: 'body is too long for a Reply.' }
  }
  return bodyResult
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
    // The specific Discovery entry the first-contact letter is actually
    // addressed from — matches send_first_letter's own
    // p_question_answer_id. Required here so can_evaluate_safety_context
    // and the fingerprint can bind the real mutation context, not just
    // the recipient (see this module's own ParsedEvaluateRequest comment).
    if (!isUuid(fields.questionAnswerId)) {
      return { ok: false, error: 'questionAnswerId must be a UUID.' }
    }
    const bodyResult = readFirstLetterBody(fields.body)
    if (!bodyResult.ok) return bodyResult
    // first_letter structurally has no Postcard — never even parsed for
    // this surface, matching send_first_letter's own signature, which
    // has no p_postcard parameter at all.
    return {
      ok: true,
      request: {
        surface,
        contextId: fields.recipientId,
        secondaryContextId: null,
        questionAnswerId: fields.questionAnswerId,
        title: null,
        topics: null,
        postcard: null,
        body: bodyResult.body,
      },
    }
  }

  if (surface === 'reply') {
    // Context = the letter being replied to — matches reply_to_letter's
    // own p_letter_id (app/letters/[letterId]/first-contact-response.tsx).
    if (!isUuid(fields.letterId)) {
      return { ok: false, error: 'letterId must be a UUID.' }
    }
    const bodyResult = readBody(fields.body)
    if (!bodyResult.ok) return bodyResult
    const postcardResult = readPostcard(fields.postcard)
    if (!postcardResult.ok) return postcardResult
    return {
      ok: true,
      request: {
        surface,
        contextId: fields.letterId,
        secondaryContextId: null,
        questionAnswerId: null,
        title: null,
        topics: null,
        postcard: postcardResult.postcard,
        body: bodyResult.body,
      },
    }
  }

  if (surface === 'write_anytime') {
    // Context = the correspondence — matches write_letter's own
    // p_correspondence_id (app/letters/[letterId]/moments-composer.tsx).
    if (!isUuid(fields.correspondenceId)) {
      return { ok: false, error: 'correspondenceId must be a UUID.' }
    }
    const bodyResult = readBody(fields.body)
    if (!bodyResult.ok) return bodyResult
    const postcardResult = readPostcard(fields.postcard)
    if (!postcardResult.ok) return postcardResult
    return {
      ok: true,
      request: {
        surface,
        contextId: fields.correspondenceId,
        secondaryContextId: null,
        questionAnswerId: null,
        title: null,
        topics: null,
        postcard: postcardResult.postcard,
        body: bodyResult.body,
      },
    }
  }

  if (surface === 'dispatch_publish') {
    // Context = the authenticated member's own identity, derived
    // SERVER-SIDE from the session — see this file's own
    // ParsedEvaluateRequest doc comment. Never read from the request
    // body; contextId is left null here and filled in by route.ts.
    const titleResult = readTitle(fields.title)
    if (!titleResult.ok) return titleResult
    const topicsResult = readTopics(fields.topics)
    if (!topicsResult.ok) return topicsResult
    const bodyResult = readBody(fields.body)
    if (!bodyResult.ok) return bodyResult
    const postcardResult = readPostcard(fields.postcard)
    if (!postcardResult.ok) return postcardResult
    return {
      ok: true,
      request: {
        surface,
        contextId: null,
        secondaryContextId: null,
        questionAnswerId: null,
        title: titleResult.title,
        topics: topicsResult.topics,
        postcard: postcardResult.postcard,
        body: bodyResult.body,
      },
    }
  }

  if (surface === 'dispatch_update') {
    // Context = the Dispatch being edited — matches update_dispatch's
    // own p_dispatch_id (app/board/dispatch-composer.tsx).
    if (!isUuid(fields.dispatchId)) {
      return { ok: false, error: 'dispatchId must be a UUID.' }
    }
    const titleResult = readTitle(fields.title)
    if (!titleResult.ok) return titleResult
    const topicsResult = readTopics(fields.topics)
    if (!topicsResult.ok) return topicsResult
    const bodyResult = readBody(fields.body)
    if (!bodyResult.ok) return bodyResult
    // update_dispatch has no Postcard parameter at all — never even
    // parsed for this surface (matches this file's own header note on
    // not inventing one).
    return {
      ok: true,
      request: {
        surface,
        contextId: fields.dispatchId,
        secondaryContextId: null,
        questionAnswerId: null,
        title: titleResult.title,
        topics: topicsResult.topics,
        postcard: null,
        body: bodyResult.body,
      },
    }
  }

  if (surface === 'question_answer') {
    // Context = the Question being answered — matches
    // publish_question_answer's own p_question_id (app/question/
    // question-answer.tsx).
    if (!isUuid(fields.questionId)) {
      return { ok: false, error: 'questionId must be a UUID.' }
    }
    const bodyResult = readBody(fields.body)
    if (!bodyResult.ok) return bodyResult
    return {
      ok: true,
      request: {
        surface,
        contextId: fields.questionId,
        secondaryContextId: null,
        questionAnswerId: null,
        title: null,
        topics: null,
        postcard: null,
        body: bodyResult.body,
      },
    }
  }

  if (surface === 'dispatch_reply') {
    // Context = the Dispatch being replied to; secondary context = the
    // optional parent Reply — matches create_reply's own p_dispatch_id/
    // p_parent_reply_id (app/board/[dispatchId]/reply-composer.tsx).
    if (!isUuid(fields.dispatchId)) {
      return { ok: false, error: 'dispatchId must be a UUID.' }
    }
    let parentReplyId: string | null = null
    if (fields.parentReplyId !== undefined && fields.parentReplyId !== null) {
      if (!isUuid(fields.parentReplyId)) {
        return { ok: false, error: 'parentReplyId must be a UUID.' }
      }
      parentReplyId = fields.parentReplyId
    }
    const bodyResult = readReplyBody(fields.body)
    if (!bodyResult.ok) return bodyResult
    return {
      ok: true,
      request: {
        surface,
        contextId: fields.dispatchId,
        secondaryContextId: parentReplyId,
        questionAnswerId: null,
        title: null,
        topics: null,
        postcard: null,
        body: bodyResult.body,
      },
    }
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
