import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { renderArrivalEmail } from '@/lib/email/arrival'
import type { SendEmailInput, SendEmailResult } from '@/lib/email/provider'

type ArrivalEmailContext = {
  eligible: boolean
  skip_reason: string | null
  recipient_email: string | null
  first_contact: boolean | null
  sender_pseudonym: string | null
  sender_country_code: string | null
}

type ProviderSnapshot = {
  idempotency_key: string
  from_address: string
  to_address: string
  subject: string
  html: string
  text_body: string
  first_provider_attempt_at: string
  is_new: boolean
  window_expired: boolean
}

type ClaimedJob = { id: string; letter_id: string; claim_token: string }
type CompleteResult = 'sent' | 'skipped' | 'failed' | 'manual_review'

export type ArrivalWorkerDeps = {
  /** Must be a service-role client (lib/supabase/service.ts) — the
   * RPCs this worker calls are granted to service_role only. */
  supabase: SupabaseClient
  sendEmail: (input: SendEmailInput) => Promise<SendEmailResult>
  siteOrigin: string
  artOrigin?: string | null
  limit?: number
  workerId?: string
}

export type ArrivalWorkerSummary = {
  enqueued: number
  claimed: number
  sent: number
  skipped: number
  failed: number
  manualReview: number
  sendingEnabled: boolean
}

/**
 * One scheduler tick: enqueue newly-arrived letters, then — only if the
 * global kill switch is on — claim a batch and resolve/send/complete
 * each one. Every claimed job is always completed (sent, skipped,
 * failed, or manual_review) exactly once; nothing is left dangling in
 * 'processing' by this function itself (a crashed process is instead
 * recovered by claim_arrival_email_jobs' own stale-claim reclaim, see
 * the migration).
 *
 * Every completion call is fenced to the exact claim it came from —
 * see `complete()` below — so a worker invocation that ran past the
 * 15-minute reclaim window can never clobber a newer invocation's
 * outcome for the same job.
 *
 * Payload stability (independent audit correction): Resend requires
 * the SAME request body under a reused Idempotency-Key. Since
 * resolve_arrival_email_context is deliberately re-resolved fresh on
 * every retry (pseudonym, first_contact, even the recipient's email
 * can all change between attempts), this worker freezes the exact
 * From/To/subject/HTML/text the FIRST provider attempt used — via
 * record_or_fetch_arrival_email_snapshot — and reuses that literal
 * payload on every later retry, never re-rendering what's actually
 * sent. Fresh eligibility revalidation still runs every time and can
 * still veto sending (skip) even once a snapshot exists; on top of
 * that, a retry additionally refuses to send if the recipient's email
 * has changed since the snapshot (terminal failure, not a silent
 * payload change under the existing key), or if Resend's own 24-hour
 * idempotency protection window has elapsed since the first attempt
 * (terminal 'manual_review' — we no longer know whether that first
 * attempt actually reached Resend, and refuse to guess).
 */
export async function runArrivalEmailWorker(deps: ArrivalWorkerDeps): Promise<ArrivalWorkerSummary> {
  const { supabase, sendEmail, siteOrigin, artOrigin, limit = 20, workerId = 'cron' } = deps

  const { data: enqueuedCount, error: enqueueError } = await supabase.rpc('enqueue_arrival_emails')
  if (enqueueError) throw new Error(`enqueue_arrival_emails failed: ${enqueueError.message}`)

  const { data: configRow, error: configError } = await supabase
    .from('arrival_email_system_config')
    .select('sending_enabled')
    .eq('id', true)
    .single()
  if (configError) throw new Error(`reading arrival_email_system_config failed: ${configError.message}`)

  const sendingEnabled = Boolean((configRow as { sending_enabled: boolean } | null)?.sending_enabled)

  const summary: ArrivalWorkerSummary = {
    enqueued: (enqueuedCount as number | null) ?? 0,
    claimed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    manualReview: 0,
    sendingEnabled,
  }

  // The kill switch is checked BEFORE claiming — a disabled switch
  // leaves every job untouched in 'pending', spending no retry
  // attempts, ready to send as soon as it's re-enabled (each job is
  // still revalidated fresh at that later send time).
  if (!sendingEnabled) return summary

  // Checked once, up front, rather than per job — a missing From
  // address is a deployment misconfiguration, not a per-letter
  // condition, and should stop the run loudly rather than burn
  // attempts on jobs one at a time.
  const arrivalEmailFrom = process.env.ARRIVAL_EMAIL_FROM
  if (!arrivalEmailFrom) throw new Error('ARRIVAL_EMAIL_FROM is not configured.')

  const { data: jobs, error: claimError } = await supabase.rpc('claim_arrival_email_jobs', {
    p_limit: limit,
    p_worker: workerId,
  })
  if (claimError) throw new Error(`claim_arrival_email_jobs failed: ${claimError.message}`)

  const claimedJobs = (jobs ?? []) as ClaimedJob[]
  summary.claimed = claimedJobs.length

  for (const job of claimedJobs) {
    await processJob(job)
  }

  return summary

  async function processJob(job: ClaimedJob): Promise<void> {
    const { data: contextRows, error: contextError } = await supabase.rpc('resolve_arrival_email_context', {
      p_queue_id: job.id,
    })

    if (contextError) {
      await complete(job, 'failed', { error: contextError.message })
      summary.failed += 1
      return
    }

    const context = (Array.isArray(contextRows) ? contextRows[0] : contextRows) as ArrivalEmailContext | undefined

    if (!context || !context.eligible || !context.recipient_email) {
      await complete(job, 'skipped', { error: context?.skip_reason ?? 'unknown' })
      summary.skipped += 1
      return
    }

    let rendered: ReturnType<typeof renderArrivalEmail>
    try {
      rendered = renderArrivalEmail({
        letterId: job.letter_id,
        firstContact: Boolean(context.first_contact),
        senderPseudonym: context.sender_pseudonym,
        senderCountryCode: context.sender_country_code,
        siteOrigin,
        artOrigin,
      })
    } catch (error) {
      await complete(job, 'failed', { error: error instanceof Error ? error.message : 'render failed' })
      summary.failed += 1
      return
    }

    // Stable across every retry of this exact job — never regenerated
    // per attempt.
    const idempotencyKey = `letter-arrived/${job.letter_id}`

    const { data: snapshotRows, error: snapshotError } = await supabase.rpc('record_or_fetch_arrival_email_snapshot', {
      p_queue_id: job.id,
      p_idempotency_key: idempotencyKey,
      p_from: arrivalEmailFrom,
      p_to: context.recipient_email,
      p_subject: rendered.subject,
      p_html: rendered.html,
      p_text: rendered.text,
    })

    if (snapshotError) {
      await complete(job, 'failed', { error: snapshotError.message })
      summary.failed += 1
      return
    }

    const snapshot = (Array.isArray(snapshotRows) ? snapshotRows[0] : snapshotRows) as ProviderSnapshot | undefined

    if (!snapshot) {
      await complete(job, 'failed', { error: 'record_or_fetch_arrival_email_snapshot returned no row.' })
      summary.failed += 1
      return
    }

    if (!snapshot.is_new) {
      // A retry, reusing the payload frozen on an earlier attempt. The
      // freshly-resolved recipient_email above must still match what
      // was frozen — if it doesn't, the account's email changed since
      // the first attempt, and sending either address now would be
      // wrong: the frozen one may no longer be current, and sending
      // the new one would silently change the payload under an
      // idempotency key Resend may already have associated with the
      // old one. Terminal, not retried.
      if (snapshot.to_address !== context.recipient_email) {
        await complete(job, 'failed', {
          error: 'Recipient email changed since the first provider attempt; refusing to send under the existing idempotency key.',
          retryable: false,
        })
        summary.failed += 1
        return
      }

      // Resend's own idempotency protection for this exact request is
      // only guaranteed for 24 hours after the first attempt. Past
      // that, a resend is no longer provably deduplicated at the
      // provider — an outage-driven gap (scheduler down, deploy
      // frozen) could otherwise resurrect an uncertain request outside
      // that window. Prefer a human-reviewable stop over guessing.
      if (snapshot.window_expired) {
        await complete(job, 'manual_review', {
          error:
            "Resend's 24-hour idempotency protection window has elapsed since the first provider attempt for this event; refusing to auto-resend an uncertain request.",
        })
        summary.manualReview += 1
        return
      }
    }

    const result = await sendEmail({
      from: snapshot.from_address,
      to: snapshot.to_address,
      subject: snapshot.subject,
      html: snapshot.html,
      text: snapshot.text_body,
      idempotencyKey: snapshot.idempotency_key,
    })

    if (result.ok) {
      await complete(job, 'sent', { providerMessageId: result.providerMessageId })
      summary.sent += 1
    } else {
      await complete(job, 'failed', { error: result.error, retryable: result.retryable })
      summary.failed += 1
    }
  }

  async function complete(
    job: ClaimedJob,
    result: CompleteResult,
    options: { error?: string; providerMessageId?: string | null; retryable?: boolean } = {}
  ): Promise<void> {
    const { data: applied, error: completeError } = await supabase.rpc('complete_arrival_email_job', {
      p_queue_id: job.id,
      p_claim_token: job.claim_token,
      p_result: result,
      p_error: options.error ? options.error.slice(0, 500) : null,
      p_provider_message_id: options.providerMessageId ?? null,
      p_retryable: options.retryable ?? true,
    })

    if (completeError) {
      // A failure here means the job stays 'processing' under this
      // claim_token — it will be reclaimed (with a fresh token) by the
      // stale-claim path after 15 minutes rather than silently lost.
      console.error(`complete_arrival_email_job(${job.id}, ${result}) failed: ${completeError.message}`)
      return
    }

    if (applied === false) {
      // Fenced out: another invocation already reclaimed and completed
      // this job under a newer claim_token. Not an error — this run's
      // own (redundant, now-discarded) outcome for this job simply
      // doesn't count; see this function's own doc comment.
      console.warn(`complete_arrival_email_job(${job.id}) was fenced out — a newer claim already completed it.`)
    }
  }
}
