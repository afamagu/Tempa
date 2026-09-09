// Regression coverage for two Mail Call polish checkpoint items:
//  - Moments unlock only once Letter 2 has actually DELIVERED, for
//    BOTH participants (distinct from, and stricter than, Write
//    Anytime entitlement / isEstablishedForViewer).
//  - "Mail on the way": a narrow, existence-only transit surface that
//    never touches letters_for_participant's own delivery gate.
//
// The qualification/derivation LOGIC is tested via pure simulations
// that mirror the real SQL predicates line-for-line (see
// lib/__tests__/simulateCorrespondenceRpcs.ts's own doc comments) —
// this repository cannot execute the live Postgres RPCs. The thin
// lib/letters.ts RPC wrappers are tested separately below for their
// own concern: failing closed/empty on any RPC error.
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isMomentsQualifiedForViewer,
  getIncomingMailInTransit,
  hasIncomingMailInTransit,
  incomingMailInTransitPersonIds,
} from './letters'
import {
  simulateMomentsQualifiedForViewer,
  simulateIncomingMailInTransit,
  type SimCorrespondence,
  type SimLetterRow,
} from './__tests__/simulateCorrespondenceRpcs'
import { createFakeSupabase } from './__tests__/fakeSupabase'

const A = 'user-a-saint-nico' // Letter 1's sender
const B = 'user-b-evening-quill' // Letter 1's recipient, Letter 2's sender
const C = 'user-c-a-third-mind'
const CORR = 'corr-1'
const NOW = '2026-09-04T12:00:00Z'
const PAST = '2026-09-04T09:00:00Z'
const FUTURE = '2026-09-04T15:00:00Z'

// A send-time timeline distinct from PAST/FUTURE (delivery times) —
// needed to determine which reply-type letter is CHRONOLOGICALLY
// FIRST, independent of which one happens to deliver first.
const SENT_T0 = '2026-09-04T07:00:00Z' // letter1 (root)
const SENT_T1 = '2026-09-04T07:05:00Z' // letter2 (the genuine first reply)
const SENT_T2 = '2026-09-04T07:10:00Z' // any later letter/reply

function corr(overrides: Partial<SimCorrespondence> = {}): SimCorrespondence {
  return {
    id: CORR,
    participantLow: A,
    participantHigh: B,
    status: 'active',
    establishedAt: null,
    photoConsentStatus: 'no_request',
    ...overrides,
  }
}

function letter1(): SimLetterRow {
  return { correspondenceId: CORR, senderId: A, recipientId: B, replyToId: null, deliverAt: PAST, createdAt: SENT_T0 }
}

function letter2(deliverAt: string, createdAt: string = SENT_T1): SimLetterRow {
  return { correspondenceId: CORR, senderId: B, recipientId: A, replyToId: 'letter-1', deliverAt, createdAt }
}

function laterLetter(
  id: string,
  deliverAt: string,
  senderId = B,
  recipientId = A,
  createdAt: string = SENT_T2
): SimLetterRow {
  return { correspondenceId: CORR, senderId, recipientId, replyToId: 'letter-1', deliverAt, createdAt }
}

describe('simulateMomentsQualifiedForViewer (moments_qualified_for_viewer)', () => {
  it('unauthenticated (viewerId null) is false, checked before anything else', () => {
    const letters = [letter1(), letter2(PAST)]
    expect(simulateMomentsQualifiedForViewer(corr({ establishedAt: SENT_T1 }), letters, null, NOW)).toBe(false)
  })

  it('Letter 1 only, no reply yet (establishedAt still null): false for both', () => {
    const letters = [letter1()]
    expect(simulateMomentsQualifiedForViewer(corr(), letters, A, NOW)).toBe(false)
    expect(simulateMomentsQualifiedForViewer(corr(), letters, B, NOW)).toBe(false)
  })

  it('Letter 2 sent, still in transit: false for BOTH participants — including its own sender', () => {
    const letters = [letter1(), letter2(FUTURE)]
    const correspondence = corr({ establishedAt: SENT_T1 }) // matches letter2's own createdAt
    expect(simulateMomentsQualifiedForViewer(correspondence, letters, B, NOW)).toBe(false)
    expect(simulateMomentsQualifiedForViewer(correspondence, letters, A, NOW)).toBe(false)
  })

  it('Letter 2 boundary reached (deliver_at <= now): true for both', () => {
    const letters = [letter1(), letter2(PAST)]
    const correspondence = corr({ establishedAt: SENT_T1 })
    expect(simulateMomentsQualifiedForViewer(correspondence, letters, B, NOW)).toBe(true)
    expect(simulateMomentsQualifiedForViewer(correspondence, letters, A, NOW)).toBe(true)
  })

  it('exactly at deliver_at = now counts as delivered (<=, not <)', () => {
    const letters = [letter1(), letter2(NOW)]
    expect(simulateMomentsQualifiedForViewer(corr({ establishedAt: SENT_T1 }), letters, A, NOW)).toBe(true)
  })

  it('multiple later letters sent while Letter 2 is still in transit do not flip qualification — stays false', () => {
    const letters = [
      letter1(),
      letter2(FUTURE),
      laterLetter('letter-3', FUTURE),
      laterLetter('letter-4', FUTURE),
    ]
    const correspondence = corr({ establishedAt: SENT_T1 })
    expect(simulateMomentsQualifiedForViewer(correspondence, letters, B, NOW)).toBe(false)
    expect(simulateMomentsQualifiedForViewer(correspondence, letters, A, NOW)).toBe(false)
  })

  it('once qualified, Letter 3 is in a state where a Moment may attach (qualification true regardless of which later letter is being checked)', () => {
    const letters = [letter1(), letter2(PAST), laterLetter('letter-3', FUTURE)]
    // Letter 3 itself is still in transit, but qualification is a
    // correspondence-level fact (Letter 2 arrived), not per-letter —
    // this is exactly what write_letter's new guard checks before
    // accepting p_moments on Letter 3.
    expect(simulateMomentsQualifiedForViewer(corr({ establishedAt: SENT_T1 }), letters, B, NOW)).toBe(true)
  })

  it('a non-participant gets false, never true', () => {
    const letters = [letter1(), letter2(PAST)]
    expect(simulateMomentsQualifiedForViewer(corr({ establishedAt: SENT_T1 }), letters, C, NOW)).toBe(false)
  })

  it('crossed-root case: a SECOND, later-created reply that happens to deliver EARLIER must not prematurely qualify Moments', () => {
    // letter2 (created at SENT_T1) is the letter that actually set
    // established_at — proven by reply_to_letter's own
    // established_at = coalesce(established_at, now()) always sharing
    // its transaction's now() with that same call's new letter row
    // (see the migration's own doc comment). A separate reply to the
    // correspondence's OTHER root (created later, at SENT_T2 — its own
    // is_first_reply branch ran too, but coalesce() left established_at
    // untouched) happens to have an EARLIER deliver_at (PAST) — e.g. a
    // shorter geography band, or simply favorable jitter. Qualification
    // must stay false: it's keyed to the letter whose createdAt equals
    // established_at, never to whichever reply happens to deliver
    // soonest.
    const genuineFirstReply = letter2(FUTURE, SENT_T1)
    const secondIncidentalReply: SimLetterRow = {
      correspondenceId: CORR,
      senderId: A,
      recipientId: B,
      replyToId: 'root-2',
      deliverAt: PAST,
      createdAt: SENT_T2,
    }
    const letters = [letter1(), genuineFirstReply, secondIncidentalReply]
    const correspondence = corr({ establishedAt: SENT_T1 }) // set by the GENUINE first reply, not the incidental one

    expect(simulateMomentsQualifiedForViewer(correspondence, letters, A, NOW)).toBe(false)
    expect(simulateMomentsQualifiedForViewer(correspondence, letters, B, NOW)).toBe(false)

    // Once the GENUINE first reply itself arrives, qualification
    // flips true — the second reply's own (already-past) delivery is
    // irrelevant either way, and never was what qualification actually
    // depended on.
    const lettersAfterFirstReplyArrives = [letter1(), letter2(PAST, SENT_T1), secondIncidentalReply]
    expect(simulateMomentsQualifiedForViewer(correspondence, lettersAfterFirstReplyArrives, A, NOW)).toBe(true)
  })
})

describe('simulateIncomingMailInTransit (incoming_mail_in_transit)', () => {
  it('an incoming future letter produces one row for its recipient', () => {
    const letters = [letter1(), letter2(FUTURE)]
    const result = simulateIncomingMailInTransit(letters, A, NOW)
    expect(result).toEqual([{ correspondenceId: CORR, otherParticipantId: B }])
  })

  it('a delivered letter is no longer "on the way"', () => {
    const letters = [letter1(), letter2(PAST)]
    expect(simulateIncomingMailInTransit(letters, A, NOW)).toEqual([])
  })

  it('an outgoing future letter never appears in the sender\'s own incoming list', () => {
    const letters = [letter1(), letter2(FUTURE)]
    // B sent letter2; from B's own perspective it must never show up as
    // "incoming" mail — this function is keyed on recipient_id, not
    // sender_id.
    expect(simulateIncomingMailInTransit(letters, B, NOW)).toEqual([])
  })

  it('multiple travelling letters from the same correspondent still produce one row', () => {
    const letters = [
      letter1(),
      letter2(FUTURE),
      laterLetter('letter-3', FUTURE),
      laterLetter('letter-4', FUTURE),
    ]
    const result = simulateIncomingMailInTransit(letters, A, NOW)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ correspondenceId: CORR, otherParticipantId: B })
  })

  it('travelling letters from two different correspondents mark only those two', () => {
    const otherCorr = 'corr-2'
    const letters = [
      letter1(),
      letter2(FUTURE),
      { correspondenceId: otherCorr, senderId: C, recipientId: A, replyToId: 'root-2', deliverAt: FUTURE },
    ]
    const result = simulateIncomingMailInTransit(letters, A, NOW)
    const otherIds = result.map((r) => r.otherParticipantId).sort()
    expect(otherIds).toEqual([B, C].sort())
    expect(result).toHaveLength(2)
  })
})

describe('hasIncomingMailInTransit / incomingMailInTransitPersonIds (pure)', () => {
  it('Home: no rows means no indicator', () => {
    expect(hasIncomingMailInTransit([])).toBe(false)
  })

  it('Home: any row means the indicator shows', () => {
    expect(hasIncomingMailInTransit([{ correspondenceId: CORR, otherParticipantId: B }])).toBe(true)
  })

  it('Letterbox: collapses to a Set, one entry per correspondent regardless of row count', () => {
    const ids = incomingMailInTransitPersonIds([
      { correspondenceId: CORR, otherParticipantId: B },
      { correspondenceId: 'corr-2', otherParticipantId: B },
      { correspondenceId: 'corr-3', otherParticipantId: C },
    ])
    expect(ids).toEqual(new Set([B, C]))
  })
})

describe('isMomentsQualifiedForViewer / getIncomingMailInTransit — fail closed on RPC error', () => {
  it('isMomentsQualifiedForViewer returns false (never throws, never true) when the RPC errors', async () => {
    const supabase = createFakeSupabase({
      rpc: () => ({ data: null, error: { message: 'boom', code: 'XXTST' } }),
    }) as unknown as SupabaseClient
    await expect(isMomentsQualifiedForViewer(supabase, CORR)).resolves.toBe(false)
  })

  it('isMomentsQualifiedForViewer passes through a true result', async () => {
    const supabase = createFakeSupabase({
      rpc: () => ({ data: true, error: null }),
    }) as unknown as SupabaseClient
    await expect(isMomentsQualifiedForViewer(supabase, CORR)).resolves.toBe(true)
  })

  it('getIncomingMailInTransit returns an empty list (never throws) when the RPC errors', async () => {
    const supabase = createFakeSupabase({
      rpc: () => ({ data: null, error: { message: 'boom', code: 'XXTST' } }),
    }) as unknown as SupabaseClient
    await expect(getIncomingMailInTransit(supabase)).resolves.toEqual([])
  })

  it('getIncomingMailInTransit maps snake_case rows to exactly the two safe fields — nothing else passes through, even if present on the raw row', async () => {
    const supabase = createFakeSupabase({
      rpc: () => ({
        data: [
          {
            correspondence_id: CORR,
            other_participant_id: B,
            // Defensive: even if a future RPC revision accidentally
            // over-selected, the explicit field-by-field mapping in
            // getIncomingMailInTransit must not pass these through.
            deliver_at: FUTURE,
            body: 'should never appear client-side',
          },
        ],
        error: null,
      }),
    }) as unknown as SupabaseClient

    const result = await getIncomingMailInTransit(supabase)
    expect(result).toEqual([{ correspondenceId: CORR, otherParticipantId: B }])
    expect(Object.keys(result[0]).sort()).toEqual(['correspondenceId', 'otherParticipantId'])
  })
})
