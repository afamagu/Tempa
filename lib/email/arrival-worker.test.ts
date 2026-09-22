import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runArrivalEmailWorker } from './arrival-worker'
import type { SendEmailInput, SendEmailResult } from './provider'

type RpcCall = { fn: string; params: Record<string, unknown> | undefined }
type ClaimedJob = { id: string; letter_id: string; claim_token: string }
type SnapshotOverride = {
  is_new?: boolean
  from_address?: string
  to_address?: string
  subject?: string
  html?: string
  text_body?: string
  first_provider_attempt_at?: string
  window_expired?: boolean
}

function makeFakeSupabase(options: {
  sendingEnabled: boolean
  enqueuedCount?: number
  claimedJobs?: ClaimedJob[]
  contextByJobId?: Record<string, Record<string, unknown>>
  snapshotByJobId?: Record<string, SnapshotOverride>
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
      if (fn === 'record_or_fetch_arrival_email_snapshot') {
        const jobId = params?.p_queue_id as string
        const override = options.snapshotByJobId?.[jobId]
        // Default: this call is what froze the snapshot (is_new true)
        // — echoes back exactly the candidate values the worker sent,
        // matching real record_or_fetch_arrival_email_snapshot
        // behavior on a genuine first attempt.
        const snapshot = {
          idempotency_key: params?.p_idempotency_key,
          from_address: override?.from_address ?? (params?.p_from as string),
          to_address: override?.to_address ?? (params?.p_to as string),
          subject: override?.subject ?? (params?.p_subject as string),
          html: override?.html ?? (params?.p_html as string),
          text_body: override?.text_body ?? (params?.p_text as string),
          first_provider_attempt_at: override?.first_provider_attempt_at ?? '2026-10-01T00:00:00Z',
          is_new: override?.is_new ?? true,
          window_expired: override?.window_expired ?? false,
        }
        return { data: [snapshot], error: null }
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
const ORIGINAL_ENV = { ...process.env }

function eligibleContext(overrides: Record<string, unknown> = {}) {
  return {
    eligible: true,
    skip_reason: null,
    recipient_email: 'recipient@example.com',
    first_contact: true,
    sender_pseudonym: null,
    sender_country_code: null,
    ...overrides,
  }
}

describe('runArrivalEmailWorker', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ARRIVAL_EMAIL_FROM: 'Tempa <letters@jointempa.com>' }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('kill switch off — enqueues but never claims, and reports sendingEnabled: false', async () => {
    const { supabase, calls } = makeFakeSupabase({ sendingEnabled: false, enqueuedCount: 3 })
    const sendEmail = vi.fn()

    const summary = await runArrivalEmailWorker({
      supabase: supabase as never,
      sendEmail,
      siteOrigin: SITE_ORIGIN,
    })

    expect(summary).toEqual({ enqueued: 3, claimed: 0, sent: 0, skipped: 0, failed: 0, manualReview: 0, sendingEnabled: false })
    expect(calls.map((c) => c.fn)).toEqual(['enqueue_arrival_emails'])
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('throws loudly if ARRIVAL_EMAIL_FROM is not configured, before claiming any job', async () => {
    delete process.env.ARRIVAL_EMAIL_FROM
    const { supabase, calls } = makeFakeSupabase({ sendingEnabled: true, claimedJobs: [] })

    await expect(
      runArrivalEmailWorker({ supabase: supabase as never, sendEmail: vi.fn(), siteOrigin: SITE_ORIGIN })
    ).rejects.toThrow('ARRIVAL_EMAIL_FROM')
    expect(calls.map((c) => c.fn)).not.toContain('claim_arrival_email_jobs')
  })

  it('normal (first-attempt) path — snapshot is frozen from the freshly rendered payload and sent with from/to/idempotencyKey', async () => {
    const { supabase, calls } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-1', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: { 'job-1': eligibleContext() },
    })
    const sendEmail = vi.fn(async (input: SendEmailInput): Promise<SendEmailResult> => {
      expect(input.from).toBe('Tempa <letters@jointempa.com>')
      expect(input.to).toBe('recipient@example.com')
      expect(input.idempotencyKey).toBe(`letter-arrived/${LETTER_ID}`)
      return { ok: true, providerMessageId: 'resend-msg-1' }
    })

    const summary = await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })

    expect(summary.sent).toBe(1)
    const snapshotCall = calls.find((c) => c.fn === 'record_or_fetch_arrival_email_snapshot')
    expect(snapshotCall?.params).toMatchObject({ p_queue_id: 'job-1', p_to: 'recipient@example.com' })
    const completeCall = calls.find((c) => c.fn === 'complete_arrival_email_job')
    expect(completeCall?.params).toMatchObject({ p_result: 'sent', p_provider_message_id: 'resend-msg-1' })
  })

  it('retry path — the FROZEN payload is reused even though the current context has changed (different pseudonym/first_contact)', async () => {
    const frozenSubject = 'A letter has arrived for you'
    const frozenHtml = '<p>frozen original html</p>'
    const frozenText = 'frozen original text'
    const { supabase } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-2', letter_id: LETTER_ID, claim_token: TOKEN }],
      // The CURRENT resolve call now returns a different sender pseudonym
      // and first_contact than whatever produced the frozen snapshot —
      // simulating that the correspondence became established, or the
      // sender's pseudonym changed, between the first attempt and this retry.
      contextByJobId: {
        'job-2': eligibleContext({ first_contact: false, sender_pseudonym: 'A Brand New Pseudonym', sender_country_code: 'FR' }),
      },
      snapshotByJobId: {
        'job-2': {
          is_new: false,
          from_address: 'Tempa <letters@jointempa.com>',
          to_address: 'recipient@example.com',
          subject: frozenSubject,
          html: frozenHtml,
          text_body: frozenText,
        },
      },
    })
    const sendEmail = vi.fn(async (input: SendEmailInput): Promise<SendEmailResult> => {
      // Must reuse the frozen payload verbatim, NOT anything a fresh
      // render of the changed context would have produced.
      expect(input.subject).toBe(frozenSubject)
      expect(input.html).toBe(frozenHtml)
      expect(input.text).toBe(frozenText)
      return { ok: true, providerMessageId: 'resend-msg-2' }
    })

    const summary = await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })

    expect(summary.sent).toBe(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('a retry always uses the exact same idempotencyKey as the first attempt, across separate worker runs', async () => {
    const { supabase } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-1', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: { 'job-1': eligibleContext() },
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

  it('recipient email changed since the snapshot — refuses to send under the existing idempotency key, terminal failure, no send attempted', async () => {
    const { supabase, calls } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-3', letter_id: LETTER_ID, claim_token: TOKEN }],
      // The account's email is now different from what was frozen.
      contextByJobId: { 'job-3': eligibleContext({ recipient_email: 'new-address@example.com' }) },
      snapshotByJobId: {
        'job-3': { is_new: false, to_address: 'old-address@example.com' },
      },
    })
    const sendEmail = vi.fn()

    const summary = await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })

    expect(sendEmail).not.toHaveBeenCalled()
    expect(summary.failed).toBe(1)
    expect(summary.sent).toBe(0)
    const completeCall = calls.find((c) => c.fn === 'complete_arrival_email_job')
    expect(completeCall?.params).toMatchObject({ p_result: 'failed', p_retryable: false })
    expect((completeCall?.params as Record<string, unknown>)?.p_error).toMatch(/email changed/i)
  })

  it('idempotency window expired (24h) on a retry — refuses to auto-resend, terminal manual_review, no send attempted', async () => {
    const { supabase, calls } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-4', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: { 'job-4': eligibleContext() },
      snapshotByJobId: {
        'job-4': { is_new: false, to_address: 'recipient@example.com', window_expired: true },
      },
    })
    const sendEmail = vi.fn()

    const summary = await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })

    expect(sendEmail).not.toHaveBeenCalled()
    expect(summary.manualReview).toBe(1)
    expect(summary.sent).toBe(0)
    expect(summary.failed).toBe(0)
    const completeCall = calls.find((c) => c.fn === 'complete_arrival_email_job')
    expect(completeCall?.params).toMatchObject({ p_result: 'manual_review' })
  })

  it('a brand-new snapshot (is_new: true) never triggers the email-changed or window-expiry checks, even if window_expired happened to be true', async () => {
    const { supabase } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-5', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: { 'job-5': eligibleContext() },
      snapshotByJobId: {
        'job-5': { is_new: true, window_expired: true }, // should never matter when is_new
      },
    })
    const sendEmail = vi.fn(async (): Promise<SendEmailResult> => ({ ok: true, providerMessageId: 'id' }))

    const summary = await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(summary.sent).toBe(1)
    expect(summary.manualReview).toBe(0)
  })

  it('blocked/hidden/ineligible path — skip_reason from the RPC is recorded, no email is sent, no snapshot is created', async () => {
    const { supabase, calls } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-6', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: {
        'job-6': { eligible: false, skip_reason: 'blocked', recipient_email: null, first_contact: null, sender_pseudonym: null, sender_country_code: null },
      },
    })
    const sendEmail = vi.fn()

    const summary = await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })

    expect(summary.skipped).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(calls.map((c) => c.fn)).not.toContain('record_or_fetch_arrival_email_snapshot')
    const completeCall = calls.find((c) => c.fn === 'complete_arrival_email_job')
    expect(completeCall?.params).toMatchObject({ p_queue_id: 'job-6', p_claim_token: TOKEN, p_result: 'skipped', p_error: 'blocked' })
  })

  it('provider-failure path — send failing marks the job failed with the provider error and passes retryable through', async () => {
    const { supabase, calls } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-7', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: { 'job-7': eligibleContext({ first_contact: false, sender_pseudonym: 'Quiet Harbor', sender_country_code: 'JP' }) },
    })
    const sendEmail = vi.fn(
      async (): Promise<SendEmailResult> => ({ ok: false, error: 'Resend responded 500', retryable: true })
    )

    const summary = await runArrivalEmailWorker({ supabase: supabase as never, sendEmail, siteOrigin: SITE_ORIGIN })

    expect(summary.failed).toBe(1)
    expect(summary.sent).toBe(0)
    const completeCall = calls.find((c) => c.fn === 'complete_arrival_email_job')
    expect(completeCall?.params).toMatchObject({
      p_queue_id: 'job-7',
      p_claim_token: TOKEN,
      p_result: 'failed',
      p_error: 'Resend responded 500',
      p_retryable: true,
    })
  })

  it('a non-retryable provider failure (e.g. permanent 4xx) is passed through as p_retryable: false', async () => {
    const { supabase, calls } = makeFakeSupabase({
      sendingEnabled: true,
      claimedJobs: [{ id: 'job-8', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: { 'job-8': eligibleContext() },
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
        { id: 'job-9', letter_id: LETTER_ID, claim_token: 'token-9' },
        { id: 'job-10', letter_id: LETTER_ID, claim_token: 'token-10' },
      ],
      contextByJobId: { 'job-10': eligibleContext({ recipient_email: 'ok@example.com' }) },
    })
    // job-9 has no entry in contextByJobId, so resolve_arrival_email_context
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
      claimedJobs: [{ id: 'job-11', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: { 'job-11': eligibleContext() },
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
      claimedJobs: [{ id: 'job-12', letter_id: LETTER_ID, claim_token: TOKEN }],
      contextByJobId: { 'job-12': eligibleContext() },
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
