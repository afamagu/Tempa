import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { classifyContent, combineClassifications } from '@/lib/safety'
import { buildEvaluateResponse, parseEvaluateRequest, type ParsedPostcard } from '@/lib/safety/route-contract'

/** The EXACT jsonb shape write_letter/reply_to_letter's own p_postcard
 * accepts (postcard_key/reveal_line/back_message) — see route-
 * contract.ts's own ParsedPostcard doc comment. Snake_case only at this
 * one boundary, where the RPC payload is actually built; everywhere
 * else in this route/module stays the ordinary TS camelCase. */
function toPostcardJsonb(postcard: ParsedPostcard | null): { postcard_key: string; reveal_line: string | null; back_message: string } | null {
  if (!postcard) return null
  return { postcard_key: postcard.postcardKey, reveal_line: postcard.revealLine, back_message: postcard.backMessage }
}

/**
 * Safety 2 — Checkpoint 2's one evaluation entrypoint.
 *
 * Trust boundary: member session -> THIS Route Handler ->
 * public.can_evaluate_safety_context (member's OWN authenticated
 * session, never the service-role client — proves the caller is
 * legitimately entitled to operate on the context they named, the same
 * way the real Letter RPCs would) -> the canonical TS classifier
 * (lib/safety/classify.ts) -> the server-only service-role recording
 * RPC (public.record_safety_evaluation) -> a safety evaluation row. The
 * caller's identity is derived ONLY from the authenticated session
 * below (`supabase.auth.getUser()`) — a request-body `userId` is never
 * read or trusted, and this route never accepts one. The service-role
 * client is used only AFTER both the session check AND the context-
 * authorization check have already succeeded, and only to call the one
 * trusted recording RPC — never to read/write anything else.
 *
 * The context-authorization check exists because a meaningful/high/
 * severe evaluation creates a signal (and can open a case)
 * independent of whether any mutation ever happens — an authenticated
 * member must not be able to manufacture Safety evidence merely by
 * posting syntactically-valid UUIDs for a recipient/letter/
 * correspondence they have no real relationship to. An unauthorized
 * context fails here, before classification or any write to
 * safety_evaluations/safety_signals/safety_cases.
 *
 * Never returns the classifier's own risk band, reason codes, or
 * extracted indicators to the browser — only a coarse member-facing
 * disposition and, when relevant, a generic warning-copy key (see
 * lib/safety/route-contract.ts's own doc comments for why).
 *
 * Checkpoint 3: the returned evaluationId is now consumed transactionally
 * by send_first_letter/reply_to_letter/write_letter (docs/sql/2026-10-05-
 * safety-checkpoint3-letter-wiring.sql, via tempa_private.
 * consume_safety_evaluation) — those RPCs now REQUIRE a valid, matching,
 * unconsumed, unexpired evaluation id before any Letter can be created;
 * the old signatures without one no longer exist. This endpoint itself
 * is fail-closed for those three surfaces: if this call fails, the
 * composer must never fall back to sending unscreened (see each
 * composer's own submit handler, lib/safety/send-with-safety.ts).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = parseEvaluateRequest(payload)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const postcardJsonb = toPostcardJsonb(parsed.request.postcard)

  // Context authorization — via the member's own authenticated
  // session/RLS path, never the service-role client. Must happen
  // before classification or any write; see this route's own doc
  // comment above. p_postcard lets the restricted-account gate apply
  // correctly (a restricted member may still evaluate a plain-text
  // reply/write, just not one carrying a Postcard — see can_evaluate_
  // safety_context's own doc comment).
  const { data: authorized, error: authorizationError } = await supabase.rpc('can_evaluate_safety_context', {
    p_surface: parsed.request.surface,
    p_context_id: parsed.request.contextId,
    p_question_answer_id: parsed.request.questionAnswerId,
    p_postcard: postcardJsonb,
  })

  if (authorizationError) {
    console.error('[safety] can_evaluate_safety_context failed', {
      message: authorizationError.message,
      code: authorizationError.code,
      surface: parsed.request.surface,
    })
    return NextResponse.json({ error: 'Could not evaluate this content right now. Please try again.' }, { status: 500 })
  }

  if (!authorized) {
    return NextResponse.json({ error: 'You are not able to write in this context.' }, { status: 403 })
  }

  // The body and any user-written Postcard text (Reveal Line/back
  // message) are classified SEPARATELY and combined structurally
  // (combineClassifications), never concatenated into one string first
  // — see that function's own doc comment for why. A complete
  // solicitation entirely contained in the Postcard therefore produces
  // the same intervention it would in the body.
  const classifications = [classifyContent(parsed.request.body)]
  if (parsed.request.postcard?.revealLine) {
    classifications.push(classifyContent(parsed.request.postcard.revealLine))
  }
  if (parsed.request.postcard?.backMessage) {
    classifications.push(classifyContent(parsed.request.postcard.backMessage))
  }
  const classification = combineClassifications(classifications)

  const service = createServiceClient()
  const { data, error } = await service
    .rpc('record_safety_evaluation', {
      p_user_id: user.id,
      p_surface: parsed.request.surface,
      p_context_id: parsed.request.contextId,
      p_question_answer_id: parsed.request.questionAnswerId,
      p_postcard: postcardJsonb,
      p_body: parsed.request.body,
      p_risk_band: classification.riskBand,
      p_reason_codes: classification.reasonCodes,
      p_mutation_disposition: classification.mutationDisposition,
      p_escalate_case: classification.escalateCase,
    })
    .single()

  if (error || !data) {
    console.error('[safety] record_safety_evaluation failed', {
      message: error?.message,
      code: error?.code,
      surface: parsed.request.surface,
    })
    return NextResponse.json({ error: 'Could not evaluate this content right now. Please try again.' }, { status: 500 })
  }

  const row = data as { evaluation_id: string; expires_at: string; is_new: boolean }
  return NextResponse.json(buildEvaluateResponse(row.evaluation_id, classification.mutationDisposition))
}
