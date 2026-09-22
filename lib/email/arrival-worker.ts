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

type ClaimedJob = { id: string; letter_id: string }

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
  sendingEnabled: boolean
}

/**
 * One scheduler tick: enqueue newly-arrived letters, then — only if the
 * global kill switch is on — claim a batch and resolve/send/complete
 * each one. Every claimed job is always completed (sent, skipped, or
 * failed) exactly once; nothing is left dangling in 'processing' by
 * this function itself (a crashed process is instead recovered by
 * claim_arrival_email_jobs' own stale-claim reclaim, see the
 * migration).
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
    sendingEnabled,
  }

  // The kill switch is checked BEFORE claiming — a disabled switch
  // leaves every job untouched in 'pending', spending no retry
  // attempts, ready to send as soon as it's re-enabled (each job is
  // still revalidated fresh at that later send time).
  if (!sendingEnabled) return summary

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
      await complete(job.id, 'failed', contextError.message)
      summary.failed += 1
      return
    }

    const context = (Array.isArray(contextRows) ? contextRows[0] : contextRows) as ArrivalEmailContext | undefined

    if (!context || !context.eligible || !context.recipient_email) {
      await complete(job.id, 'skipped', context?.skip_reason ?? 'unknown')
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
      await complete(job.id, 'failed', error instanceof Error ? error.message : 'render failed')
      summary.failed += 1
      return
    }

    const result = await sendEmail({
      to: context.recipient_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })

    if (result.ok) {
      await complete(job.id, 'sent')
      summary.sent += 1
    } else {
      await complete(job.id, 'failed', result.error)
      summary.failed += 1
    }
  }

  async function complete(queueId: string, result: 'sent' | 'skipped' | 'failed', error?: string): Promise<void> {
    const { error: completeError } = await supabase.rpc('complete_arrival_email_job', {
      p_queue_id: queueId,
      p_result: result,
      p_error: error ? error.slice(0, 500) : null,
    })
    // A failure here means the job stays 'processing' — it will be
    // reclaimed by the stale-claim path after 15 minutes rather than
    // silently lost.
    if (completeError) {
      console.error(`complete_arrival_email_job(${queueId}, ${result}) failed: ${completeError.message}`)
    }
  }
}
