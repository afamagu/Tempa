// Behavioral proof of the queue-management RPCs' documented properties
// — the rollout cutover boundary, idempotent enqueue, and claim-token
// fencing — against the simulation in simulateArrivalEmailRpcs.ts. See
// that file's own header for why a simulation rather than a live DB.
// The SQL migration text itself is separately verified, string-for-
// string, by arrivalEmailQueueMigration.test.ts.

import { describe, it, expect } from 'vitest'
import {
  createSimState,
  enqueueArrivalEmails,
  claimArrivalEmailJobs,
  completeArrivalEmailJob,
  recordOrFetchArrivalEmailSnapshot,
  type SimLetter,
} from './simulateArrivalEmailRpcs'

const CUTOVER = '2026-10-01T00:00:00.000Z'

function letter(id: string, deliverAt: string, recipient = 'recipient-1'): SimLetter {
  return { id, recipient_id: recipient, deliver_at: deliverAt }
}

describe('enqueue_arrival_emails — rollout cutover boundary', () => {
  it('excludes a historical letter that arrived before the cutover, even though deliver_at <= now()', () => {
    const state = createSimState({
      enqueueAfter: CUTOVER,
      now: '2026-10-02T00:00:00.000Z',
      letters: [letter('letter-old', '2026-09-15T00:00:00.000Z')],
    })
    const inserted = enqueueArrivalEmails(state)
    expect(inserted).toBe(0)
    expect(state.queue).toHaveLength(0)
  })

  it('includes a letter delivered exactly at the cutover instant', () => {
    const state = createSimState({
      enqueueAfter: CUTOVER,
      now: '2026-10-01T00:00:00.000Z',
      letters: [letter('letter-exact', CUTOVER)],
    })
    const inserted = enqueueArrivalEmails(state)
    expect(inserted).toBe(1)
    expect(state.queue[0].letter_id).toBe('letter-exact')
  })

  it('includes a letter delivered after the cutover', () => {
    const state = createSimState({
      enqueueAfter: CUTOVER,
      now: '2026-10-05T00:00:00.000Z',
      letters: [letter('letter-new', '2026-10-03T00:00:00.000Z')],
    })
    const inserted = enqueueArrivalEmails(state)
    expect(inserted).toBe(1)
  })

  it('still excludes a future, still-travelling letter regardless of the cutover — arrival, not eligibility, is what gates enqueue', () => {
    const state = createSimState({
      enqueueAfter: CUTOVER,
      now: '2026-10-05T00:00:00.000Z',
      letters: [letter('letter-future', '2026-10-10T00:00:00.000Z')],
    })
    const inserted = enqueueArrivalEmails(state)
    expect(inserted).toBe(0)
    expect(state.queue).toHaveLength(0)
  })

  it('a mixed batch only enqueues the eligible letters: excludes historical and future, includes at/after cutover', () => {
    const state = createSimState({
      enqueueAfter: CUTOVER,
      now: '2026-10-05T00:00:00.000Z',
      letters: [
        letter('historical', '2026-09-01T00:00:00.000Z'),
        letter('at-cutover', CUTOVER),
        letter('after-cutover', '2026-10-03T00:00:00.000Z'),
        letter('future', '2026-10-20T00:00:00.000Z'),
      ],
    })
    enqueueArrivalEmails(state)
    const enqueuedIds = state.queue.map((q) => q.letter_id).sort()
    expect(enqueuedIds).toEqual(['after-cutover', 'at-cutover'])
  })

  it('overlapping/repeated enqueue calls remain idempotent — a letter is never queued twice', () => {
    const state = createSimState({
      enqueueAfter: CUTOVER,
      now: '2026-10-05T00:00:00.000Z',
      letters: [letter('letter-1', '2026-10-03T00:00:00.000Z')],
    })
    const first = enqueueArrivalEmails(state)
    const second = enqueueArrivalEmails(state)
    const third = enqueueArrivalEmails(state)
    expect(first).toBe(1)
    expect(second).toBe(0)
    expect(third).toBe(0)
    expect(state.queue).toHaveLength(1)
  })

  it('idempotency holds even as more letters arrive over time — only the newly-eligible ones are added on each call', () => {
    const state = createSimState({
      enqueueAfter: CUTOVER,
      now: '2026-10-01T00:00:00.000Z',
      letters: [letter('letter-1', CUTOVER)],
    })
    expect(enqueueArrivalEmails(state)).toBe(1)

    state.now = '2026-10-02T00:00:00.000Z'
    state.letters.push(letter('letter-2', '2026-10-02T00:00:00.000Z'))
    expect(enqueueArrivalEmails(state)).toBe(1)
    expect(state.queue).toHaveLength(2)

    // Running again with no new arrivals inserts nothing further.
    expect(enqueueArrivalEmails(state)).toBe(0)
    expect(state.queue).toHaveLength(2)
  })
})

describe('claim_arrival_email_jobs / complete_arrival_email_job — claim-token fencing', () => {
  function stateWithOneQueuedLetter(now = '2026-10-05T00:00:00.000Z') {
    const state = createSimState({
      enqueueAfter: CUTOVER,
      now,
      letters: [letter('letter-1', '2026-10-03T00:00:00.000Z')],
    })
    enqueueArrivalEmails(state)
    return state
  }

  it('normal claim/completion — the worker that claimed the job is the one that completes it, using the token it was given', () => {
    const state = stateWithOneQueuedLetter()
    const [job] = claimArrivalEmailJobs(state, 20, 'worker-a')
    expect(job.status).toBe('processing')
    expect(job.claim_token).toBeTruthy()

    const applied = completeArrivalEmailJob(state, job.id, job.claim_token!, 'sent', null, 'resend-msg-1')
    expect(applied).toBe(true)
    expect(state.queue[0].status).toBe('sent')
    expect(state.queue[0].provider_message_id).toBe('resend-msg-1')
  })

  it('a stale claim is reclaimed with a DIFFERENT token once 15+ minutes have passed', () => {
    const state = stateWithOneQueuedLetter('2026-10-05T00:00:00.000Z')
    const [jobA] = claimArrivalEmailJobs(state, 20, 'worker-a')
    const staleToken = jobA.claim_token!

    // Worker A stalls. 16 minutes pass — the scheduler runs again.
    state.now = '2026-10-05T00:16:00.000Z'
    const reclaimed = claimArrivalEmailJobs(state, 20, 'worker-b')
    expect(reclaimed).toHaveLength(1)
    expect(reclaimed[0].id).toBe(jobA.id)
    expect(reclaimed[0].claim_token).not.toBe(staleToken)
    expect(reclaimed[0].claimed_by).toBe('worker-b')
    // Reclaiming counts as another attempt.
    expect(reclaimed[0].attempts).toBe(2)
  })

  it("an old (fenced-out) worker's completion is rejected as a no-op — it can never clobber the newer claim's outcome", () => {
    const state = stateWithOneQueuedLetter('2026-10-05T00:00:00.000Z')
    const [jobA] = claimArrivalEmailJobs(state, 20, 'worker-a')
    const staleToken = jobA.claim_token!

    state.now = '2026-10-05T00:16:00.000Z'
    const [jobB] = claimArrivalEmailJobs(state, 20, 'worker-b')
    // Worker B finishes first.
    expect(completeArrivalEmailJob(state, jobB.id, jobB.claim_token!, 'sent', null, 'resend-msg-2')).toBe(true)
    expect(state.queue[0].status).toBe('sent')
    expect(state.queue[0].provider_message_id).toBe('resend-msg-2')

    // Worker A's late, redundant send finally finishes and tries to
    // complete with its now-invalid token.
    const staleCompletion = completeArrivalEmailJob(state, jobA.id, staleToken, 'failed', 'worker-a timed out')
    expect(staleCompletion).toBe(false)
    // The row is untouched by the stale call — still exactly what
    // worker B recorded.
    expect(state.queue[0].status).toBe('sent')
    expect(state.queue[0].provider_message_id).toBe('resend-msg-2')
    expect(state.queue[0].last_error).toBeNull()
  })

  it('the CURRENT worker holding the live token always succeeds', () => {
    const state = stateWithOneQueuedLetter()
    const [job] = claimArrivalEmailJobs(state, 20, 'worker-a')
    expect(completeArrivalEmailJob(state, job.id, job.claim_token!, 'skipped', 'preference_disabled')).toBe(true)
    expect(state.queue[0].status).toBe('skipped')
    expect(state.queue[0].skipped_reason).toBe('preference_disabled')
  })

  it('completing with the right id but a wrong/guessed token is fenced out the same way', () => {
    const state = stateWithOneQueuedLetter()
    const [job] = claimArrivalEmailJobs(state, 20, 'worker-a')
    const applied = completeArrivalEmailJob(state, job.id, 'not-the-real-token', 'sent')
    expect(applied).toBe(false)
    expect(state.queue[0].status).toBe('processing')
  })
})

describe('complete_arrival_email_job — corrected exponential backoff (5m, 10m, 20m, 40m)', () => {
  it('the first failure (attempts=1 at claim time) backs off exactly 5 minutes, not 10', () => {
    const state = createSimState({
      enqueueAfter: CUTOVER,
      now: '2026-10-05T00:00:00.000Z',
      letters: [letter('letter-1', '2026-10-03T00:00:00.000Z')],
    })
    enqueueArrivalEmails(state)
    const [job] = claimArrivalEmailJobs(state, 20, 'worker-a')
    expect(job.attempts).toBe(1)

    completeArrivalEmailJob(state, job.id, job.claim_token!, 'failed', 'provider 500')
    const row = state.queue[0]
    expect(row.status).toBe('pending')
    const backoffMinutes = (new Date(row.next_attempt_at).getTime() - new Date(state.now).getTime()) / 60000
    expect(backoffMinutes).toBe(5)
  })

  it('successive failures back off 5, 10, 20, 40 minutes, then terminate as failed on the 5th attempt', () => {
    const state = createSimState({
      enqueueAfter: CUTOVER,
      now: '2026-10-05T00:00:00.000Z',
      letters: [letter('letter-1', '2026-10-03T00:00:00.000Z')],
    })
    enqueueArrivalEmails(state)

    const expectedBackoffMinutes = [5, 10, 20, 40]
    for (let i = 0; i < 4; i++) {
      const [job] = claimArrivalEmailJobs(state, 20, 'worker-a')
      expect(job.attempts).toBe(i + 1)
      completeArrivalEmailJob(state, job.id, job.claim_token!, 'failed', `attempt ${i + 1} failed`)
      const row = state.queue[0]
      expect(row.status).toBe('pending')
      const backoffMinutes = (new Date(row.next_attempt_at).getTime() - new Date(state.now).getTime()) / 60000
      expect(backoffMinutes).toBe(expectedBackoffMinutes[i])
      // Fast-forward past the backoff so the next claim can pick it up.
      state.now = row.next_attempt_at
    }

    // 5th and final attempt.
    const [job] = claimArrivalEmailJobs(state, 20, 'worker-a')
    expect(job.attempts).toBe(5)
    completeArrivalEmailJob(state, job.id, job.claim_token!, 'failed', 'attempt 5 failed')
    expect(state.queue[0].status).toBe('failed')
  })

  it('a non-retryable failure (permanent provider rejection) terminates immediately, without waiting through the backoff ladder', () => {
    const state = createSimState({
      enqueueAfter: CUTOVER,
      now: '2026-10-05T00:00:00.000Z',
      letters: [letter('letter-1', '2026-10-03T00:00:00.000Z')],
    })
    enqueueArrivalEmails(state)
    const [job] = claimArrivalEmailJobs(state, 20, 'worker-a')
    expect(job.attempts).toBe(1)

    completeArrivalEmailJob(state, job.id, job.claim_token!, 'failed', 'Resend responded 422: invalid recipient', null, false)
    expect(state.queue[0].status).toBe('failed')
    expect(state.queue[0].last_error).toContain('422')
  })
})

describe('record_or_fetch_arrival_email_snapshot — fenced to the exact claim, same shape as completion', () => {
  function claimedState(now = '2026-10-05T00:00:00.000Z') {
    const state = createSimState({
      enqueueAfter: CUTOVER,
      now,
      letters: [letter('letter-1', '2026-10-03T00:00:00.000Z')],
    })
    enqueueArrivalEmails(state)
    const [job] = claimArrivalEmailJobs(state, 20, 'worker-a')
    return { state, job }
  }

  it('1. the current (valid) claim token can create the first snapshot', () => {
    const { state, job } = claimedState()
    const result = recordOrFetchArrivalEmailSnapshot(
      state, job.id, job.claim_token!, 'letter-arrived/letter-1',
      'Tempa <letters@jointempa.com>', 'recipient@example.com', 'A letter has arrived for you', '<p>html</p>', 'text'
    )
    expect(result.claim_valid).toBe(true)
    if (result.claim_valid) {
      expect(result.is_new).toBe(true)
      expect(result.to_address).toBe('recipient@example.com')
    }
    expect(state.providerRequests).toHaveLength(1)
  })

  it('2. a stale claim token CANNOT create the first snapshot — no row is written at all', () => {
    const { state, job } = claimedState()
    const result = recordOrFetchArrivalEmailSnapshot(
      state, job.id, 'not-the-real-token', 'letter-arrived/letter-1',
      'Tempa <letters@jointempa.com>', 'recipient@example.com', 'subject', '<p>html</p>', 'text'
    )
    expect(result).toEqual({ claim_valid: false })
    expect(state.providerRequests).toHaveLength(0)
  })

  it('3. a stale claim token CANNOT fetch an existing snapshot either, once another invocation has reclaimed the job', () => {
    const { state, job } = claimedState('2026-10-05T00:00:00.000Z')
    const staleToken = job.claim_token!
    // The original worker successfully freezes a snapshot...
    recordOrFetchArrivalEmailSnapshot(
      state, job.id, staleToken, 'letter-arrived/letter-1',
      'Tempa <letters@jointempa.com>', 'recipient@example.com', 'subject', '<p>html</p>', 'text'
    )
    expect(state.providerRequests).toHaveLength(1)

    // ...then stalls past the 15-minute reclaim window, and a new
    // invocation reclaims the job with a fresh token.
    state.now = '2026-10-05T00:16:00.000Z'
    claimArrivalEmailJobs(state, 20, 'worker-b')

    // The original (now stale) token can no longer even FETCH the
    // snapshot it itself created.
    const staleFetch = recordOrFetchArrivalEmailSnapshot(
      state, job.id, staleToken, 'letter-arrived/letter-1',
      'Tempa <letters@jointempa.com>', 'recipient@example.com', 'subject', '<p>html</p>', 'text'
    )
    expect(staleFetch).toEqual({ claim_valid: false })
    // The existing snapshot is untouched — still exactly one row.
    expect(state.providerRequests).toHaveLength(1)
  })

  it('5. the reclaimed (current) worker can fetch/create and proceed normally, getting the frozen payload back', () => {
    const { state, job } = claimedState('2026-10-05T00:00:00.000Z')
    recordOrFetchArrivalEmailSnapshot(
      state, job.id, job.claim_token!, 'letter-arrived/letter-1',
      'Tempa <letters@jointempa.com>', 'recipient@example.com', 'original subject', '<p>original html</p>', 'original text'
    )

    state.now = '2026-10-05T00:16:00.000Z'
    const [reclaimed] = claimArrivalEmailJobs(state, 20, 'worker-b')

    const result = recordOrFetchArrivalEmailSnapshot(
      state, reclaimed.id, reclaimed.claim_token!, 'letter-arrived/letter-1',
      'Tempa <letters@jointempa.com>', 'recipient@example.com', 'a DIFFERENT subject rendered this time', '<p>different html</p>', 'different text'
    )

    expect(result.claim_valid).toBe(true)
    if (result.claim_valid) {
      // Reuses the FROZEN original payload, not the different candidate
      // this call passed in — same "is_new: false → discard the fresh
      // render" contract as before, now proven to survive a reclaim too.
      expect(result.is_new).toBe(false)
      expect(result.subject).toBe('original subject')
      expect(result.html).toBe('<p>original html</p>')
    }
    expect(state.providerRequests).toHaveLength(1)
  })

  it('6. a successful snapshot access refreshes the lease (claimed_at) for the current claim', () => {
    const { state, job } = claimedState('2026-10-05T00:00:00.000Z')
    const claimedAtAfterClaim = state.queue[0].claimed_at

    state.now = '2026-10-05T00:10:00.000Z'
    recordOrFetchArrivalEmailSnapshot(
      state, job.id, job.claim_token!, 'letter-arrived/letter-1',
      'Tempa <letters@jointempa.com>', 'recipient@example.com', 'subject', '<p>html</p>', 'text'
    )

    expect(state.queue[0].claimed_at).toBe('2026-10-05T00:10:00.000Z')
    expect(state.queue[0].claimed_at).not.toBe(claimedAtAfterClaim)
  })

  it('a stale claim token does NOT refresh claimed_at — ownership is checked before any state changes', () => {
    const { state, job } = claimedState('2026-10-05T00:00:00.000Z')
    const claimedAtAfterClaim = state.queue[0].claimed_at

    state.now = '2026-10-05T00:10:00.000Z'
    recordOrFetchArrivalEmailSnapshot(
      state, job.id, 'wrong-token', 'letter-arrived/letter-1',
      'Tempa <letters@jointempa.com>', 'recipient@example.com', 'subject', '<p>html</p>', 'text'
    )

    expect(state.queue[0].claimed_at).toBe(claimedAtAfterClaim)
  })

  it('7. completion fencing still works unchanged, end to end with snapshot fencing: the stale worker is fenced out of BOTH the snapshot and the completion, the reclaiming worker owns both', () => {
    const { state, job } = claimedState('2026-10-05T00:00:00.000Z')
    const staleToken = job.claim_token!
    recordOrFetchArrivalEmailSnapshot(
      state, job.id, staleToken, 'letter-arrived/letter-1',
      'Tempa <letters@jointempa.com>', 'recipient@example.com', 'subject', '<p>html</p>', 'text'
    )

    state.now = '2026-10-05T00:16:00.000Z'
    const [reclaimed] = claimArrivalEmailJobs(state, 20, 'worker-b')

    // Reclaiming worker fetches the snapshot and completes normally.
    const snapshot = recordOrFetchArrivalEmailSnapshot(
      state, reclaimed.id, reclaimed.claim_token!, 'letter-arrived/letter-1',
      'Tempa <letters@jointempa.com>', 'recipient@example.com', 'subject', '<p>html</p>', 'text'
    )
    expect(snapshot.claim_valid).toBe(true)
    expect(completeArrivalEmailJob(state, reclaimed.id, reclaimed.claim_token!, 'sent', null, 'resend-msg-1')).toBe(true)
    expect(state.queue[0].status).toBe('sent')

    // The stale worker's late attempts are fenced out of BOTH steps —
    // it can neither read the snapshot nor complete the job.
    const staleSnapshot = recordOrFetchArrivalEmailSnapshot(
      state, job.id, staleToken, 'letter-arrived/letter-1',
      'Tempa <letters@jointempa.com>', 'recipient@example.com', 'subject', '<p>html</p>', 'text'
    )
    expect(staleSnapshot).toEqual({ claim_valid: false })
    const staleCompletion = completeArrivalEmailJob(state, job.id, staleToken, 'failed', 'stale worker timed out')
    expect(staleCompletion).toBe(false)

    // The reclaiming worker's outcome is untouched by either stale call.
    expect(state.queue[0].status).toBe('sent')
    expect(state.queue[0].provider_message_id).toBe('resend-msg-1')
  })
})
