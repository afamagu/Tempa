// A behavioral simulation of the queue-management RPCs in
// docs/sql/2026-10-01-arrival-email-delivery.sql (enqueue_arrival_
// emails, claim_arrival_email_jobs, complete_arrival_email_job) — same
// convention as simulateReportRpcs.ts: this proves the documented
// ORDER/ARITHMETIC of the logic (the cutover boundary, the anti-join +
// ON CONFLICT idempotency, the claim-token fencing, the corrected
// backoff formula), not live Postgres/RLS behavior itself (that
// migration is prepared but not executed). The SQL migration text
// (verified separately by arrivalEmailQueueMigration.test.ts's string
// assertions) is the actual authority for exact wording.

export type SimLetter = {
  id: string
  recipient_id: string
  deliver_at: string
}

export type SimQueueStatus = 'pending' | 'processing' | 'sent' | 'skipped' | 'failed' | 'manual_review'

export type SimQueueRow = {
  id: string
  letter_id: string
  recipient_id: string
  status: SimQueueStatus
  attempts: number
  max_attempts: number
  next_attempt_at: string
  claimed_at: string | null
  claimed_by: string | null
  claim_token: string | null
  sent_at: string | null
  provider_message_id: string | null
  skipped_reason: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type SimProviderRequest = {
  queue_id: string
  idempotency_key: string
  from_address: string
  to_address: string
  subject: string
  html: string
  text_body: string
  first_provider_attempt_at: string
}

export type SimState = {
  letters: SimLetter[]
  queue: SimQueueRow[]
  providerRequests: SimProviderRequest[]
  enqueueAfter: string
  /** Simulated now() — every function call reads this, never the real clock. */
  now: string
}

let nextId = 1
function freshId(prefix: string): string {
  return `${prefix}-${nextId++}`
}
function freshToken(): string {
  return `token-${nextId++}`
}

export function createSimState(overrides: Partial<SimState> = {}): SimState {
  return {
    letters: [],
    queue: [],
    providerRequests: [],
    enqueueAfter: overrides.enqueueAfter ?? '2026-10-01T00:00:00.000Z',
    now: overrides.now ?? '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Mirrors enqueue_arrival_emails(): deliver_at <= now() AND
 * deliver_at >= enqueue_after AND no existing queue row for the
 * letter (anti-join), with an ON CONFLICT (letter_id) DO NOTHING
 * backstop against a genuinely concurrent double-insert of the same
 * letter_id within one call. Returns the number of rows inserted. */
export function enqueueArrivalEmails(state: SimState): number {
  const cutoff = new Date(state.enqueueAfter).getTime()
  const now = new Date(state.now).getTime()
  const alreadyQueued = new Set(state.queue.map((q) => q.letter_id))

  let inserted = 0
  for (const letter of state.letters) {
    const deliverAt = new Date(letter.deliver_at).getTime()
    if (deliverAt > now) continue
    if (deliverAt < cutoff) continue
    if (alreadyQueued.has(letter.id)) continue

    state.queue.push({
      id: freshId('queue'),
      letter_id: letter.id,
      recipient_id: letter.recipient_id,
      status: 'pending',
      attempts: 0,
      max_attempts: 5,
      next_attempt_at: state.now,
      claimed_at: null,
      claimed_by: null,
      claim_token: null,
      sent_at: null,
      provider_message_id: null,
      skipped_reason: null,
      last_error: null,
      created_at: state.now,
      updated_at: state.now,
    })
    alreadyQueued.add(letter.id)
    inserted += 1
  }
  return inserted
}

const STALE_PROCESSING_MS = 15 * 60 * 1000

/** Mirrors claim_arrival_email_jobs(): pending-and-due, or
 * processing-and-stuck-for-15+-minutes. Issues a brand-new claim_token
 * on every claim (including a reclaim), which is what invalidates
 * whatever token an earlier crashed/slow worker was holding. */
export function claimArrivalEmailJobs(state: SimState, limit: number, worker: string): SimQueueRow[] {
  const now = new Date(state.now).getTime()

  const claimable = state.queue
    .filter((q) => {
      if (q.status === 'pending' && new Date(q.next_attempt_at).getTime() <= now) return true
      if (q.status === 'processing' && q.claimed_at && now - new Date(q.claimed_at).getTime() > STALE_PROCESSING_MS) {
        return true
      }
      return false
    })
    .sort((a, b) => new Date(a.next_attempt_at).getTime() - new Date(b.next_attempt_at).getTime())
    .slice(0, Math.max(limit, 0))

  for (const row of claimable) {
    row.status = 'processing'
    row.claimed_at = state.now
    row.claimed_by = worker
    row.claim_token = freshToken()
    row.attempts += 1
    row.updated_at = state.now
  }

  return claimable.map((row) => ({ ...row }))
}

export type CompleteResult = 'sent' | 'skipped' | 'failed' | 'manual_review'

/** Mirrors complete_arrival_email_job(): only applies when the row is
 * still 'processing' AND the supplied token matches its current
 * claim_token — otherwise a fenced-out no-op (returns false). Backoff
 * uses `attempts - 1` (the corrected formula) so the FIRST failure
 * (attempts already at 1 from claim time) backs off 5 minutes, not 10. */
export function completeArrivalEmailJob(
  state: SimState,
  queueId: string,
  claimToken: string,
  result: CompleteResult,
  error: string | null = null,
  providerMessageId: string | null = null,
  retryable = true
): boolean {
  const row = state.queue.find((q) => q.id === queueId && q.status === 'processing' && q.claim_token === claimToken)
  if (!row) return false

  if (result === 'sent') {
    row.status = 'sent'
    row.sent_at = state.now
    row.provider_message_id = providerMessageId
    row.last_error = null
  } else if (result === 'skipped') {
    row.status = 'skipped'
    row.skipped_reason = error
  } else if (result === 'manual_review') {
    row.status = 'manual_review'
    row.last_error = error
  } else {
    if (!retryable || row.attempts >= row.max_attempts) {
      row.status = 'failed'
      row.last_error = error
    } else {
      const backoffMs = 5 * 60 * 1000 * 2 ** (row.attempts - 1)
      row.status = 'pending'
      row.next_attempt_at = new Date(new Date(state.now).getTime() + backoffMs).toISOString()
      row.last_error = error
    }
  }
  row.updated_at = state.now
  return true
}

const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000

export type SnapshotResult =
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

/** Mirrors record_or_fetch_arrival_email_snapshot(): fenced to the
 * exact claim requesting it, the same shape as
 * completeArrivalEmailJob — only a row that is still 'processing' AND
 * whose claim_token matches gets past the ownership check. A stale
 * token (already reclaimed by a newer claim) gets `claim_valid: false`
 * and nothing else — no snapshot is created or fetched, no
 * providerRequests row is ever written or read on that path. On
 * success, refreshes claimed_at (the lease heartbeat) before returning
 * — the same row a subsequent stale-processing reclaim check in
 * claimArrivalEmailJobs would look at. window_expired uses `>=` 24h,
 * matching the corrected boundary. */
export function recordOrFetchArrivalEmailSnapshot(
  state: SimState,
  queueId: string,
  claimToken: string,
  idempotencyKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
  text: string
): SnapshotResult {
  const row = state.queue.find((q) => q.id === queueId && q.status === 'processing' && q.claim_token === claimToken)
  if (!row) return { claim_valid: false }

  let existing = state.providerRequests.find((r) => r.queue_id === queueId)
  let isNew = false
  if (!existing) {
    existing = {
      queue_id: queueId,
      idempotency_key: idempotencyKey,
      from_address: from,
      to_address: to,
      subject,
      html,
      text_body: text,
      first_provider_attempt_at: state.now,
    }
    state.providerRequests.push(existing)
    isNew = true
  }

  // Lease heartbeat — taken only once ownership is confirmed, mirrors
  // the migration's `update ... set claimed_at = now() ... where id =
  // p_queue_id` immediately before its own final `return query`.
  row.claimed_at = state.now
  row.updated_at = state.now

  const elapsedMs = new Date(state.now).getTime() - new Date(existing.first_provider_attempt_at).getTime()

  return {
    claim_valid: true,
    idempotency_key: existing.idempotency_key,
    from_address: existing.from_address,
    to_address: existing.to_address,
    subject: existing.subject,
    html: existing.html,
    text_body: existing.text_body,
    first_provider_attempt_at: existing.first_provider_attempt_at,
    is_new: isNew,
    window_expired: elapsedMs >= IDEMPOTENCY_WINDOW_MS,
  }
}
