import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { renderReplyReminderEmail } from '@/lib/email/reply-reminder'
import type { SendEmailInput, SendEmailResult } from '@/lib/email/provider'
import { isWritingRhythm, writingRhythmLabel } from '@/lib/writing-rhythm'

type ReminderEmailContext = {
  claim_valid: boolean
  eligible: boolean
  skip_reason: string | null
  recipient_email: string | null
  counterpart_pseudonym: string | null
  rhythm: string | null
}

type ProviderSnapshot =
  | { claim_valid: false }
  | {
      claim_valid: true
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

type ClaimedJob = {
  id: string
  source_letter_id: string
  email_claim_token: string
}

type CompleteResult = 'sent' | 'skipped' | 'failed' | 'manual_review'

export type ReplyReminderWorkerDeps = {
  supabase: SupabaseClient
  sendEmail: (input: SendEmailInput) => Promise<SendEmailResult>
  siteOrigin: string
  limit?: number
  workerId?: string
}

export type ReplyReminderWorkerSummary = {
  enqueued: number
  claimed: number
  sent: number
  skipped: number
  failed: number
  manualReview: number
  sendingEnabled: boolean
}

/**
 * One scheduler tick. Enqueue always runs because in-app reminders do not
 * depend on email being enabled. Provider work only starts when the separate
 * Phase 8 kill switch is on.
 *
 * As with arrival email, every provider retry is claim-fenced and revalidates
 * eligibility before sending. The first provider request body is frozen and
 * later retries reuse it literally under the same idempotency key. After
 * Resend's 24-hour protection window, an uncertain send goes to manual_review
 * rather than risking a duplicate reminder.
 */
export async function runReplyReminderEmailWorker(
  deps: ReplyReminderWorkerDeps
): Promise<ReplyReminderWorkerSummary> {
  const { supabase, sendEmail, siteOrigin, limit = 20, workerId = 'cron' } = deps

  const { data: enqueuedCount, error: enqueueError } = await supabase.rpc('enqueue_reply_reminders')
  if (enqueueError) throw new Error(`enqueue_reply_reminders failed: ${enqueueError.message}`)

  const { data: configRow, error: configError } = await supabase
    .from('reply_reminder_system_config')
    .select('sending_enabled')
    .eq('id', true)
    .single()
  if (configError) throw new Error(`reading reply_reminder_system_config failed: ${configError.message}`)

  const sendingEnabled = Boolean((configRow as { sending_enabled: boolean } | null)?.sending_enabled)
  const summary: ReplyReminderWorkerSummary = {
    enqueued: (enqueuedCount as number | null) ?? 0,
    claimed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    manualReview: 0,
    sendingEnabled,
  }

  if (!sendingEnabled) return summary

  // Reuse Tempa's established outbound sender unless operations explicitly
  // provide a reminder-specific From address.
  const fromAddress = process.env.REPLY_REMINDER_EMAIL_FROM || process.env.ARRIVAL_EMAIL_FROM
  if (!fromAddress) throw new Error('REPLY_REMINDER_EMAIL_FROM or ARRIVAL_EMAIL_FROM is not configured.')

  const { data: jobs, error: claimError } = await supabase.rpc('claim_reply_reminder_email_jobs', {
    p_limit: limit,
    p_worker: workerId,
  })
  if (claimError) throw new Error(`claim_reply_reminder_email_jobs failed: ${claimError.message}`)

  const claimedJobs = (jobs ?? []) as ClaimedJob[]
  summary.claimed = claimedJobs.length

  for (const job of claimedJobs) {
    await processJob(job)
  }

  return summary

  async function processJob(job: ClaimedJob): Promise<void> {
    const { data: contextRows, error: contextError } = await supabase.rpc(
      'resolve_reply_reminder_email_context',
      { p_reminder_id: job.id, p_claim_token: job.email_claim_token }
    )

    if (contextError) {
      await complete(job, 'failed', { error: contextError.message })
      summary.failed += 1
      return
    }

    const context = (Array.isArray(contextRows) ? contextRows[0] : contextRows) as ReminderEmailContext | undefined

    if (!context?.claim_valid) {
      // Ownership was already lost to a newer claim; do not contact provider
      // and do not try to complete under a stale token.
      return
    }

    if (!context.eligible || !context.recipient_email) {
      await complete(job, 'skipped', { error: context.skip_reason ?? 'not_eligible' })
      summary.skipped += 1
      return
    }

    let rendered: ReturnType<typeof renderReplyReminderEmail>
    try {
      rendered = renderReplyReminderEmail({
        letterId: job.source_letter_id,
        counterpartPseudonym: context.counterpart_pseudonym,
        rhythmLabel: isWritingRhythm(context.rhythm) ? writingRhythmLabel(context.rhythm) : null,
        siteOrigin,
      })
    } catch (error) {
      await complete(job, 'failed', {
        error: error instanceof Error ? error.message : 'render failed',
        retryable: false,
      })
      summary.failed += 1
      return
    }

    const idempotencyKey = `reply-reminder/${job.source_letter_id}`
    const { data: snapshotRows, error: snapshotError } = await supabase.rpc(
      'record_or_fetch_reply_reminder_email_snapshot',
      {
        p_reminder_id: job.id,
        p_claim_token: job.email_claim_token,
        p_idempotency_key: idempotencyKey,
        p_from: fromAddress,
        p_to: context.recipient_email,
        p_subject: rendered.subject,
        p_html: rendered.html,
        p_text: rendered.text,
      }
    )

    if (snapshotError) {
      await complete(job, 'failed', { error: snapshotError.message })
      summary.failed += 1
      return
    }

    const snapshot = (Array.isArray(snapshotRows) ? snapshotRows[0] : snapshotRows) as ProviderSnapshot | undefined
    if (!snapshot) {
      await complete(job, 'failed', {
        error: 'record_or_fetch_reply_reminder_email_snapshot returned no row.',
      })
      summary.failed += 1
      return
    }

    if (!snapshot.claim_valid) return

    if (!snapshot.is_new) {
      if (snapshot.to_address !== context.recipient_email) {
        await complete(job, 'failed', {
          error: 'Recipient email changed since the first provider attempt; refusing to send under the existing idempotency key.',
          retryable: false,
        })
        summary.failed += 1
        return
      }

      if (snapshot.window_expired) {
        await complete(job, 'manual_review', {
          error: "Resend's 24-hour idempotency protection window has elapsed; refusing to auto-resend an uncertain reminder.",
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
    const { data: applied, error: completeError } = await supabase.rpc(
      'complete_reply_reminder_email_job',
      {
        p_reminder_id: job.id,
        p_claim_token: job.email_claim_token,
        p_result: result,
        p_error: options.error ? options.error.slice(0, 500) : null,
        p_provider_message_id: options.providerMessageId ?? null,
        p_retryable: options.retryable ?? true,
      }
    )

    if (completeError) {
      console.error(`complete_reply_reminder_email_job(${job.id}, ${result}) failed: ${completeError.message}`)
      return
    }

    if (applied === false) {
      console.warn(`complete_reply_reminder_email_job(${job.id}) was fenced out by a newer claim.`)
    }
  }
}
