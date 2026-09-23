import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { classifyContent } from '@/lib/safety'
import { buildEvaluateResponse, parseEvaluateRequest } from '@/lib/safety/route-contract'

/**
 * Safety 2 — Checkpoint 2's one evaluation entrypoint.
 *
 * Trust boundary: member session -> THIS Route Handler -> the
 * canonical TS classifier (lib/safety/classify.ts) -> the server-only
 * service-role recording RPC (public.record_safety_evaluation) -> a
 * safety evaluation row. The caller's identity is derived ONLY from
 * the authenticated session below (`supabase.auth.getUser()`) — a
 * request-body `userId` is never read or trusted, and this route never
 * accepts one. The service-role client is used only AFTER that
 * session check has already succeeded, and only to call the one
 * trusted recording RPC — never to read/write anything else.
 *
 * Never returns the classifier's own risk band, reason codes, or
 * extracted indicators to the browser — only a coarse member-facing
 * disposition and, when relevant, a generic warning-copy key (see
 * lib/safety/route-contract.ts's own doc comments for why).
 *
 * Not yet wired into any Letter RPC — Checkpoint 3's job. Calling this
 * endpoint today records an evaluation but nothing currently consumes
 * or send-gates on it.
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

  const classification = classifyContent(parsed.request.body)

  const service = createServiceClient()
  const { data, error } = await service
    .rpc('record_safety_evaluation', {
      p_user_id: user.id,
      p_surface: parsed.request.surface,
      p_context_id: parsed.request.contextId,
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
