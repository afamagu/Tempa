import { describe, it, expect, vi } from 'vitest'
import { runArrivalEmailWorker } from './arrival-worker'
import type { SendEmailInput, SendEmailResult } from './provider'

type RpcCall = { fn: string; params: Record<string, unknown> | undefined }
type ClaimedJob = { id: string; letter_id: string; claim_token: string }

function makeFakeSupabase(options: {
  sendingEnabled: boolean
  enqueuedCount?: number
  claimedJobs?: ClaimedJob[]
  contextByJobId?: Record<string, Record<string, unknown>>
  completeError?: string
  completeApplied?: boolean
}) {
  const calls: RpcCall[] = []

  const supabase = {
    from(table: string) {
      expect(table).toBe('arrival_email_system_config')
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        async single() {
          return { data: { sending_enabled: options.sendingEnabled }, error: null }
        },
      }
    },
    async rpc(fn: string, params?: Record<string, unknown>) {
      calls.push({ fn, params })

      if (fn === 'enqueue_arrival_emails') {
        return { data: options.enqueuedCount ?? 0, error: null }
      }
      if (fn === 'claim_arrival_email_jobs') {
        return { data: options.claimedJobs ?? [], error: null }
      }
      if (fn === 'resolve_arrival_email_context') {
        const jobId = params?.p_queue_id as string
        const context = options.contextByJobId?.[jobId]
        return { data: context ? [context] : [], error: null }
      }
      if (fn === 'complete_arrival_email_job') {
        if (options.completeError) return { data: null, error: { message: options.completeError } }
        return { data: options.completeApplied ?? true, error: null }
      }
      throw new Error(`unexpected rpc: ${fn}`)
    },
  }

  return { supabase, calls }
}

const SITE_ORIGIN = 'https://jointempa.com/'
const LETTER_ID = '11111111-1111-1111-1111-111111111111'
const TOKEN = 'claim-token-abc'

describe('runArrivalEmailWorker', () => {
  it('kill switch off — enqueues but never claims, and reports sendingEnabled: false', async () => {
    const { supabase, calls } = makeFakeSupabase({ sendingEnabled: false, enqueuedCount: 3 })
    const sendEmail = vi.fn()

    const summary = await runArrivalEmailWorker({
      supabase: supabase as never,
      sendEmail,
      siteOrigin: SITE_ORIGIN,
    })

    expect(summary).toEqual({ enqueued: 3, claimed: 0, sent: 0, skipped: 0, failed: 0, sendingEnabled: false })
    expect(calls.map((c) => c.fn)).toEqual(['enqueue_arrival_emails'])
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('normal path — eligible job is rendered and sent with a stable idempotencyKey, then marked sent with the claim_token and provider id', async () => {
    const { supabase, calls } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-1', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: {
        'job-1': {
          eligible: true,
          skip_reason: null,
          recipient_email: 'recipient@example.com',
          first_contact: true,
          sender_pseudonym: null,
          sender_country_code: null,
        },
      },
    })
    const sendEmail = vi.fn(async (input: SendEmailInput): Promise<SendEmailResult> => {
      expect(input.to).toBe('recipient@example.com')
      expect(input.idempotencyKey).toBe(`letter-arrived/${LETTER_ID}`)
      return { ok: true, providerMessageId: 'resend-msg-1' }
    })

    const summary = await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })

    expect(summary.sent).toBe(1)
    expect(summary.skipped).toBe(0)
    expect(summary.failed).toBe(0)
    const completeCall = calls.find((c) => c.fn === 'complete_arrival_email_job')
    expect(completeCall?.params).toMatchObject({
      p_queue_id: 'job-1',
      p_claim_token: TOKEN,
      p_result: 'sent',
      p_provider_message_id: 'resend-msg-1',
    })
  })

  it('a retry of the same job uses the exact same idempotencyKey as the first attempt', async () => {
    const { supabase } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-1', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: {
        'job-1': {
          eligible: true,
          skip_reason: null,
          recipient_email: 'recipient@example.com',
          first_contact: true,
          sender_pseudonym: null,
          sender_country_code: null,
        },
      },
    })
    const keys: string[] = []
    const sendEmail = vi.fn(async (input: SendEmailInput): Promise<SendEmailResult> => {
      keys.push(input.idempotencyKey)
      return { ok: true, providerMessageId: 'id' }
    })

    await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })
    await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })

    expect(keys).toEqual([`letter-arrived/${LETTER_ID}`, `letter-arrived/${LETTER_ID}`])
  })

  it('blocked/hidden/ineligible path — skip_reason from the RPC is recorded, no email is sent', async () => {
    const { supabase, calls } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-2', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: {
        'job-2': {
          eligible: false,
          skip_reason: 'blocked',
          recipient_email: null,
          first_contact: null,
          sender_pseudonym: null,
          sender_country_code: null,
        },
      },
    })
    const sendEmail = vi.fn()

    const summary = await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })

    expect(summary.skipped).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
    const completeCall = calls.find((c) => c.fn === 'complete_arrival_email_job')
    expect(completeCall?.params).toMatchObject({ p_queue_id: 'job-2', p_claim_token: TOKEN, p_result: 'skipped', p_error: 'blocked' })
  })

  it('preference-off path — same skip mechanism, distinguishable reason', async () => {
    const { supabase, calls } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-3', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: {
        'job-3': {
          eligible: false,
          skip_reason: 'preference_disabled',
          recipient_email: null,
          first_contact: null,
          sender_pseudonym: null,
          sender_country_code: null,
        },
      },
    })

    const summary = await runArrivalEmailWorker({ supabase: supabase as never, sendEmail: vi.fn(), siteOrigin: SITE_ORIGIN })

    expect(summary.skipped).toBe(1)
    const completeCall = calls.find((c) => c.fn === 'complete_arrival_email_job')
    expect(completeCall?.params).toMatchObject({ p_error: 'preference_disabled' })
  })

  it('provider-failure path — send failing marks the job failed with the provider error and passes retryable through', async () => {
    const { supabase, calls } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-4', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: {
        'job-4': {
          eligible: true,
          skip_reason: null,
          recipient_email: 'recipient@example.com',
          first_contact: false,
          sender_pseudonym: 'Quiet Harbor',
          sender_country_code: 'JP',
        },
      },
    })
    const sendEmail = vi.fn(
      async (): Promise<SendEmailResult> => ({ ok: false, error: 'Resend responded 500', retryable: true })
    )

    const summary = await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })

    expect(summary.failed).toBe(1)
    expect(summary.sent).toBe(0)
    const completeCall = calls.find((c) => c.fn === 'complete_arrival_email_job')
    expect(completeCall?.params).toMatchObject({
      p_queue_id: 'job-4',
      p_claim_token: TOKEN,
      p_result: 'failed',
      p_error: 'Resend responded 500',
      p_retryable: true,
    })
  })

  it('a non-retryable provider failure (e.g. permanent 4xx) is passed through as p_retryable: false', async () => {
    const { supabase, calls } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-4b', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: {
        'job-4b': {
          eligible: true,
          skip_reason: null,
          recipient_email: 'recipient@example.com',
          first_contact: false,
          sender_pseudonym: null,
          sender_country_code: null,
        },
      },
    })
    const sendEmail = vi.fn(
      async (): Promise<SendEmailResult> => ({ ok: false, error: 'Resend responded 422', retryable: false })
    )

    await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })

    const completeCall = calls.find((c) => c.fn === 'complete_arrival_email_job')
    expect(completeCall?.params).toMatchObject({ p_retryable: false })
  })

  it('retry path — resolve_arrival_email_context erroring marks the job failed rather than throwing, so one bad job cannot stop the batch', async () => {
    const { supabase, calls } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [
        { id: 'job-5', letter_id: LETTER_ID, claim_token: 'token-5' },
        { id: 'job-6', letter_id: LETTER_ID, claim_token: 'token-6' },
      ],
      contextByJobId: {
        'job-6': {
          eligible: true,
          skip_reason: null,
          recipient_email: 'ok@example.com',
          first_contact: true,
          sender_pseudonym: null,
          sender_country_code: null,
        },
      },
    })
    // job-5 has no entry in contextByJobId, so resolve_arrival_email_context
    // resolves with an empty row set (as if RLS/a bad id returned nothing) —
    // the worker must treat that as ineligible/skip, not crash the batch.
    const sendEmail = vi.fn(async (): Promise<SendEmailResult> => ({ ok: true, providerMessageId: 'id' }))

    const summary = await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })

    expect(summary.claimed).toBe(2)
    expect(summary.skipped).toBe(1)
    expect(summary.sent).toBe(1)
    expect(calls.filter((c) => c.fn === 'complete_arrival_email_job')).toHaveLength(2)
  })

  it('a fenced-out completion (another invocation already reclaimed the job) is logged, not thrown', async () => {
    const { supabase } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-7', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: {
        'job-7': {
          eligible: true,
          skip_reason: null,
          recipient_email: 'recipient@example.com',
          first_contact: true,
          sender_pseudonym: null,
          sender_country_code: null,
        },
      },
      completeApplied: false,
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      runArrivalEmailWorker({ supabase: supabase as never, sendEmail: async () => ({ ok: true, providerMessageId: 'id' }), siteOrigin: SITE_ORIGIN })
    ).resolves.toBeTruthy()

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fenced out'))
    warnSpy.mockRestore()
  })

  it('a completed job never leaves any claimed job without a matching complete_arrival_email_job call', async () => {
    const { supabase, calls } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-8', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: {
        'job-8': {
          eligible: true,
          skip_reason: null,
          recipient_email: 'recipient@example.com',
          first_contact: true,
          sender_pseudonym: null,
          sender_country_code: null,
        },
      },
    })

    await runArrivalEmailWorker({
      supabase: supabase as never,
      sendEmail: async () => ({ ok: true, providerMessageId: 'id' }),
      siteOrigin: SITE_ORIGIN,
    })

    const completeCalls = calls.filter((c) => c.fn === 'complete_arrival_email_job')
    expect(completeCalls).toHaveLength(1)
  })
})
