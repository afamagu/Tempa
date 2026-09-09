// Regression coverage for the Mail Call viewer-scoped establishment
// fix — closing the leak where correspondences.established_at (set
// the instant a reply is SENT) was read as if it meant "this viewer
// already knows a reply exists," even for the original Letter-1
// sender before Mail Call had actually delivered that reply to them.
//
// isEstablishedForViewer is exercised against a fake
// letters_for_participant that mirrors the real view's own visibility
// predicate structurally (sender sees unconditionally; recipient only
// once deliver_at <= now) — every letter's deliverAt below is supplied
// directly as an opaque, already-decided timestamp, never recomputed
// from compute_deliver_at's actual banding/jitter formula.
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isEstablishedForViewer,
  resolveFirstContactDisplayStatus,
  hasVisibleReply,
  resolveLetterActionState,
} from './letters'
import { createFakeLettersForParticipant, type FakeParticipantLetter } from './__tests__/fakeLettersForParticipant'

const A = 'user-a-saint-nico' // Letter 1's sender
const B = 'user-b-evening-quill' // Letter 1's recipient, Letter 2's sender
const CORR = 'corr-1'
const NOW = '2026-09-04T12:00:00Z'
const PAST = '2026-09-04T09:00:00Z' // already delivered relative to NOW
const FUTURE = '2026-09-04T15:00:00Z' // still in transit relative to NOW

function letter1(): FakeParticipantLetter {
  // Letter 1 — immediate under Mail Call, so always already-delivered
  // relative to any test time here. Irrelevant to establishment itself
  // (reply_to_id is null), included only for scenario realism.
  return {
    id: 'letter-1',
    correspondenceId: CORR,
    senderId: A,
    recipientId: B,
    replyToId: null,
    deliverAt: PAST,
  }
}

function letter2(deliverAt: string): FakeParticipantLetter {
  // Letter 2 — B's reply to A, the letter that establishes the
  // correspondence. Sender B, recipient A.
  return {
    id: 'letter-2',
    correspondenceId: CORR,
    senderId: B,
    recipientId: A,
    replyToId: 'letter-1',
    deliverAt,
  }
}

function clientFor(viewerId: string, letters: FakeParticipantLetter[]) {
  return createFakeLettersForParticipant({ viewerId, now: NOW, letters }) as unknown as SupabaseClient
}

describe('isEstablishedForViewer', () => {
  it('1. before B replies: both A and B are false', async () => {
    const letters = [letter1()]
    await expect(isEstablishedForViewer(clientFor(A, letters), CORR)).resolves.toBe(false)
    await expect(isEstablishedForViewer(clientFor(B, letters), CORR)).resolves.toBe(false)
  })

  it('2. B sends delayed Letter 2 -> A: while still in transit, B is true and A is false', async () => {
    const letters = [letter1(), letter2(FUTURE)]
    await expect(isEstablishedForViewer(clientFor(B, letters), CORR)).resolves.toBe(true)
    await expect(isEstablishedForViewer(clientFor(A, letters), CORR)).resolves.toBe(false)
  })

  it('3. once Letter 2 becomes visible to A (deliver_at <= now): both A and B are true', async () => {
    const letters = [letter1(), letter2(PAST)]
    await expect(isEstablishedForViewer(clientFor(B, letters), CORR)).resolves.toBe(true)
    await expect(isEstablishedForViewer(clientFor(A, letters), CORR)).resolves.toBe(true)
  })

  it('4. exactly at deliver_at = now, the reply already counts as visible (<=, not <)', async () => {
    const letters = [letter1(), letter2(NOW)]
    await expect(isEstablishedForViewer(clientFor(A, letters), CORR)).resolves.toBe(true)
  })

  it('is scoped to the correspondence id given — a reply in a different correspondence never counts', async () => {
    const letters = [letter1(), { ...letter2(PAST), correspondenceId: 'corr-other' }]
    await expect(isEstablishedForViewer(clientFor(A, letters), CORR)).resolves.toBe(false)
  })
})

describe('resolveFirstContactDisplayStatus (app/write/[recipientId]/page.tsx)', () => {
  it('A does not receive "replied" UI before delivery — downgrades to sent', () => {
    expect(resolveFirstContactDisplayStatus('replied', false)).toBe('sent')
  })

  it('shows "replied" once this viewer can actually see the reply', () => {
    expect(resolveFirstContactDisplayStatus('replied', true)).toBe('replied')
  })

  it('never touches a non-replied status either way', () => {
    expect(resolveFirstContactDisplayStatus('sent', false)).toBe('sent')
    expect(resolveFirstContactDisplayStatus('sent', true)).toBe('sent')
    expect(resolveFirstContactDisplayStatus('closed', false)).toBe('closed')
  })
})

describe('hasVisibleReply (app/home/page.tsx)', () => {
  it('Home does not reveal continuation before delivery — no visible reply letter yet', () => {
    expect(hasVisibleReply([{ replyToId: null }])).toBe(false)
  })

  it('reveals continuation once a reply letter is actually visible to this viewer', () => {
    expect(hasVisibleReply([{ replyToId: null }, { replyToId: 'letter-1' }])).toBe(true)
  })

  it('an empty list (no letters at all yet) is false', () => {
    expect(hasVisibleReply([])).toBe(false)
  })
})

describe('resolveLetterActionState fed viewer-scoped establishment (app/letters/[letterId]/page.tsx)', () => {
  it('A gets no Moments/quill before delivery', () => {
    const state = resolveLetterActionState(false, false, true, 'replied')
    expect(state.showWriteQuill).toBe(false)
  })

  it('B does get Write Anytime immediately after sending Letter 2', () => {
    const state = resolveLetterActionState(true, false, false, 'replied')
    expect(state.showWriteQuill).toBe(true)
  })
})

describe('end-to-end viewer asymmetry while Letter 2 is in transit', () => {
  it('B can reach the ordinary composer for Letter 3 while Letter 2 remains in transit', async () => {
    // Letter 2 is still travelling to A (future deliverAt) — B, as its
    // own sender, must still see establishment as true, which is what
    // app/letters/with/[userId]/write/page.tsx now requires before
    // rendering MomentsComposer for a Letter 3 send.
    const letters = [letter1(), letter2(FUTURE)]
    const bEstablished = await isEstablishedForViewer(clientFor(B, letters), CORR)
    expect(bEstablished).toBe(true)
    expect(resolveLetterActionState(bEstablished, false, false, 'replied').showWriteQuill).toBe(true)

    const aEstablished = await isEstablishedForViewer(clientFor(A, letters), CORR)
    expect(aEstablished).toBe(false)
    expect(resolveLetterActionState(aEstablished, false, true, 'replied').showWriteQuill).toBe(false)
  })
})
