import { describe, it, expect } from 'vitest'
import {
  resolveLetterActionState,
  resolveReplyToId,
  isEffectivelyExpired,
  shouldMarkLetterOpened,
  type Letter,
} from './letters'
import {
  simulateFirstReplyEstablishment,
  simulateEstablishedAtBackfill,
  momentsAllowedOnReply,
  simulateWriteLetter,
  WriteLetterError,
  type SimCorrespondence,
  type SimLetter,
} from './__tests__/simulateCorrespondenceRpcs'

const A = 'user-a'
const B = 'user-b'
const C = 'user-c'

function corr(overrides: Partial<SimCorrespondence> = {}): SimCorrespondence {
  return {
    id: 'corr-1',
    participantLow: A,
    participantHigh: B,
    status: 'active',
    establishedAt: null,
    photoConsentStatus: 'no_request',
    ...overrides,
  }
}

describe('established_at backfill (docs/sql/2026-09-03-correspondence-established-at.sql)', () => {
  it('1. an existing established correspondence backfills correctly, using the first reply\'s own created_at', () => {
    const letters = [
      { id: 'root', replyToId: null, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'reply', replyToId: 'root', createdAt: '2026-01-03T00:00:00Z' },
    ]
    expect(simulateEstablishedAtBackfill(letters)).toBe('2026-01-03T00:00:00Z')
  })

  it('2. an unreplied first-contact correspondence does NOT backfill (stays null, never guessed)', () => {
    const letters = [{ id: 'root', replyToId: null, createdAt: '2026-01-01T00:00:00Z' }]
    expect(simulateEstablishedAtBackfill(letters)).toBeNull()
  })
})

describe('reply_to_letter sets established_at on the first reply (docs/sql/2026-09-03-reply-to-letter-established-at.sql)', () => {
  it('3. a successful first reply sets established_at', () => {
    const result = simulateFirstReplyEstablishment(corr(), true, '2026-02-01T00:00:00Z')
    expect(result.establishedAt).toBe('2026-02-01T00:00:00Z')
    expect(result.status).toBe('active')
  })

  it('never overwrites an already-set established_at (coalesce)', () => {
    const already = corr({ establishedAt: '2026-01-01T00:00:00Z' })
    const result = simulateFirstReplyEstablishment(already, true, '2026-02-01T00:00:00Z')
    expect(result.establishedAt).toBe('2026-01-01T00:00:00Z')
  })

  it('14. Moments remain unavailable on Letter 2 (is_first_reply)', () => {
    expect(momentsAllowedOnReply(true)).toBe(false)
    expect(momentsAllowedOnReply(false)).toBe(true)
  })
})

describe('write_letter authorization (docs/sql/2026-09-03-write-letter-rpc.sql)', () => {
  it('4. fails before establishment (established_at null)', () => {
    const c = corr({ establishedAt: null })
    expect(() => simulateWriteLetter(c, [], A, 'hello', null)).toThrow(WriteLetterError)
  })

  it('5. either participant can write once established', () => {
    const c = corr({ establishedAt: '2026-01-01T00:00:00Z' })
    expect(() => simulateWriteLetter(c, [], A, 'from A', null)).not.toThrow()
    expect(() => simulateWriteLetter(c, [], B, 'from B', null)).not.toThrow()
  })

  it('6. one participant can send multiple consecutive letters, neither mutating the other', () => {
    const c = corr({ establishedAt: '2026-01-01T00:00:00Z' })
    const first = simulateWriteLetter(c, [], A, 'first', null)
    const second = simulateWriteLetter(c, [first], A, 'second', null)
    expect(first.status).toBe('sent')
    expect(second.status).toBe('sent')
    // The first letter is untouched by the second send — no "current
    // tip" mutation like reply_to_letter's original.status update.
    expect(first.status).toBe('sent')
  })

  it('7. recipient is derived correctly for both directions, never trusted from a caller-supplied value', () => {
    const c = corr({ establishedAt: '2026-01-01T00:00:00Z' })
    expect(simulateWriteLetter(c, [], A, 'x', null).recipientId).toBe(B)
    expect(simulateWriteLetter(c, [], B, 'x', null).recipientId).toBe(A)
  })

  it('a non-participant may never write into this correspondence', () => {
    const c = corr({ establishedAt: '2026-01-01T00:00:00Z' })
    expect(() => simulateWriteLetter(c, [], C, 'x', null)).toThrow(WriteLetterError)
  })

  it('8. a supplied reply_to_id must belong to the same correspondence', () => {
    const c = corr({ id: 'corr-1', establishedAt: '2026-01-01T00:00:00Z' })
    const foreignLetter: SimLetter = {
      id: 'foreign',
      senderId: A,
      recipientId: B,
      replyToId: null,
      correspondenceId: 'corr-OTHER',
      status: 'sent',
    }
    expect(() => simulateWriteLetter(c, [foreignLetter], A, 'x', 'foreign')).toThrow(WriteLetterError)

    const ownLetter: SimLetter = { ...foreignLetter, id: 'own', correspondenceId: 'corr-1' }
    expect(() => simulateWriteLetter(c, [ownLetter], A, 'x', 'own')).not.toThrow()
  })

  it('9. multiple contextual replies may legitimately point at the same old letter', () => {
    const c = corr({ establishedAt: '2026-01-01T00:00:00Z' })
    const old: SimLetter = { id: 'old', senderId: B, recipientId: A, replyToId: null, correspondenceId: c.id, status: 'sent' }
    const replyOne = simulateWriteLetter(c, [old], A, 'context reply one', 'old')
    const replyTwo = simulateWriteLetter(c, [old, replyOne], A, 'context reply two', 'old')
    expect(replyOne.replyToId).toBe('old')
    expect(replyTwo.replyToId).toBe('old')
    expect(replyOne.id).not.toBe(replyTwo.id)
  })

  it("it does not matter whether the referenced letter has already been replied to — no status check on it", () => {
    const c = corr({ establishedAt: '2026-01-01T00:00:00Z' })
    const alreadyAnswered: SimLetter = {
      id: 'answered',
      senderId: B,
      recipientId: A,
      replyToId: null,
      correspondenceId: c.id,
      status: 'replied',
    }
    expect(() => simulateWriteLetter(c, [alreadyAnswered], A, 'x', 'answered')).not.toThrow()
  })

  // Regression coverage (2026-09-05 live-test report): "Send Letter"
  // stayed disabled for an established correspondence's ongoing
  // composer. write_letter itself has no turn-taking condition at
  // all — these prove it directly against the real RPC's mirrored
  // authorization order, not merely against the composer's own
  // client-side canSend (see moments-composer.test.tsx for that half).
  it('16. a letter still awaiting its own reply ("in transit") never blocks another ongoing send, by either participant', () => {
    const c = corr({ establishedAt: '2026-01-01T00:00:00Z' })
    const inTransit: SimLetter = {
      id: 'in-transit',
      senderId: A,
      recipientId: B,
      replyToId: null,
      correspondenceId: c.id,
      status: 'sent', // no reply yet — still "on the way"
    }
    // The SAME sender may send again without waiting for a reply...
    expect(() => simulateWriteLetter(c, [inTransit], A, 'A again, no reply yet', null)).not.toThrow()
    // ...and the OTHER participant may independently send too, even
    // though the most recent visible letter is outgoing from their own
    // side, not an incoming one requiring a response.
    expect(() => simulateWriteLetter(c, [inTransit], B, 'B replies whenever', null)).not.toThrow()
  })

  it('17. both participants may send repeatedly and interleaved — no turn-taking, no requirement that the latest letter be incoming', () => {
    const c = corr({ establishedAt: '2026-01-01T00:00:00Z' })
    const history: SimLetter[] = []
    // A, A, B, A, B, B — an intentionally turn-violating sequence.
    for (const sender of [A, A, B, A, B, B]) {
      const letter = simulateWriteLetter(c, history, sender, 'x', null)
      expect(letter.status).toBe('sent')
      history.push(letter)
    }
    expect(history).toHaveLength(6)
  })

  // Length-policy audit (2026-09-05 live-test report): the live test
  // letter that exposed the disabled Send button was intentionally
  // very long. write_letter's real authorization order (mirrored here)
  // never inspects body length at all — that check lived entirely in
  // the ongoing composer's own now-removed aboveMax gate (see
  // moments-composer.test.tsx and letter-editor-doc.test.ts for that
  // half). These prove the RPC-level contract has no length gate,
  // matching the product rule that established letters are unlimited.
  it('18. two very long letters (well past the first-contact/Question cap) can be sent back-to-back by either participant', () => {
    const c = corr({ establishedAt: '2026-01-01T00:00:00Z' })
    const veryLongBody = 'x'.repeat(10_000)
    const first = simulateWriteLetter(c, [], A, veryLongBody, null)
    const second = simulateWriteLetter(c, [first], B, veryLongBody, null)
    expect(first.status).toBe('sent')
    expect(second.status).toBe('sent')
  })

  it('15. ongoing letters after establishment can contain Moments under the existing consent rules', () => {
    const open = corr({ establishedAt: '2026-01-01T00:00:00Z', photoConsentStatus: 'no_request' })
    expect(() => simulateWriteLetter(open, [], A, 'x', null, [{ type: 'photo' }])).not.toThrow()

    const enabled = corr({ establishedAt: '2026-01-01T00:00:00Z', photoConsentStatus: 'enabled' })
    expect(() => simulateWriteLetter(enabled, [], A, 'x', null, [{ type: 'photo' }])).not.toThrow()

    const deferred = corr({ establishedAt: '2026-01-01T00:00:00Z', photoConsentStatus: 'deferred' })
    expect(() => simulateWriteLetter(deferred, [], A, 'x', null, [{ type: 'photo' }])).toThrow(WriteLetterError)

    // A postcard-only Moment never touches the photo-consent gate at all.
    expect(() => simulateWriteLetter(deferred, [], A, 'x', null, [{ type: 'postcard' }])).not.toThrow()
  })
})

describe('resolveLetterActionState — established vs. first-contact actions never coexist', () => {
  it('an un-replied first-contact letter, viewed by its recipient: shows FirstContactResponse, never the quill', () => {
    const result = resolveLetterActionState(false, true, true, 'sent')
    expect(result.showFirstContactResponse).toBe(true)
    expect(result.showWriteQuill).toBe(false)
  })

  it('the same letter, viewed by its own sender: neither action shows (they are waiting, not deciding)', () => {
    const result = resolveLetterActionState(false, true, false, 'sent')
    expect(result.showFirstContactResponse).toBe(false)
    expect(result.showWriteQuill).toBe(false)
  })

  it('once established, viewing that SAME root letter again: only the quill shows, never FirstContactResponse', () => {
    // The transaction that sets established_at also flips the root
    // letter's own status to 'replied' — this fixture reflects that
    // real invariant rather than an impossible combination.
    const result = resolveLetterActionState(true, true, true, 'replied')
    expect(result.showFirstContactResponse).toBe(false)
    expect(result.showWriteQuill).toBe(true)
  })

  it('an ordinary letter in an established correspondence: only the quill shows', () => {
    const result = resolveLetterActionState(true, false, true, 'sent')
    expect(result.showFirstContactResponse).toBe(false)
    expect(result.showWriteQuill).toBe(true)
  })

  it('a declined/expired first-contact letter: neither action shows', () => {
    const result = resolveLetterActionState(false, true, true, 'closed')
    expect(result.showFirstContactResponse).toBe(false)
    expect(result.showWriteQuill).toBe(false)
  })

  it('the quill is available on any letter once established, regardless of sender/recipient or status', () => {
    for (const isRecipient of [true, false]) {
      for (const status of ['sent', 'replied', 'closed'] as const) {
        expect(resolveLetterActionState(true, false, isRecipient, status).showWriteQuill).toBe(true)
      }
    }
  })

  it('showFirstContactResponse and showWriteQuill are never both true, across every reachable combination', () => {
    for (const established of [true, false]) {
      for (const isFirstContactLetter of [true, false]) {
        for (const isRecipientOfTarget of [true, false]) {
          for (const status of ['sent', 'replied', 'closed'] as const) {
            const result = resolveLetterActionState(established, isFirstContactLetter, isRecipientOfTarget, status)
            expect(result.showFirstContactResponse && result.showWriteQuill).toBe(false)
          }
        }
      }
    }
  })
})

// Regression coverage for the live-test failure: MarkLetterOpened was
// gated on target status ('sent'), and isEffectivelyExpired treated
// any reply_to_id=null letter as an expired first contact regardless
// of establishment — together these permanently suppressed read-state
// tracking on already-replied/established letters.
describe('shouldMarkLetterOpened — read state must be independent of letter action status', () => {
  const BASE: Omit<Letter, 'status' | 'isUnread'> = {
    id: 'letter-1',
    senderId: B,
    recipientId: A,
    questionAnswerId: null,
    replyToId: null,
    correspondenceId: 'corr-1',
    body: 'hello',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-04T00:00:00Z',
    repliedAt: null,
    closedAt: null,
    closedBy: null,
    closeReason: null,
  }

  it('an incoming letter with status=sent, unread -> can mark read', () => {
    const letter: Letter = { ...BASE, status: 'sent', isUnread: true }
    expect(shouldMarkLetterOpened(letter, A)).toBe(true)
  })

  it('an incoming letter with status=replied, unread -> can still mark read (status is not an input)', () => {
    const letter: Letter = { ...BASE, status: 'replied', isUnread: true }
    expect(shouldMarkLetterOpened(letter, A)).toBe(true)
  })

  it('already read -> nothing to mark', () => {
    const letter: Letter = { ...BASE, status: 'replied', isUnread: false }
    expect(shouldMarkLetterOpened(letter, A)).toBe(false)
  })

  it('the viewer\'s own sent letter is never markable (they are not the recipient)', () => {
    const letter: Letter = { ...BASE, senderId: A, recipientId: B, status: 'sent', isUnread: false }
    expect(shouldMarkLetterOpened(letter, A)).toBe(false)
  })
})

describe('isEffectivelyExpired — established must gate expiry, not reply_to_id alone', () => {
  const OLD_SENT_ROOT: Letter = {
    id: 'letter-1',
    senderId: B,
    recipientId: A,
    questionAnswerId: null,
    replyToId: null, // both a genuine first-contact letter AND an ordinary quill letter look like this
    correspondenceId: 'corr-1',
    body: 'hello',
    status: 'sent',
    createdAt: '2020-01-01T00:00:00Z',
    expiresAt: '2020-01-04T00:00:00Z', // long past 72h
    isUnread: true,
    repliedAt: null,
    closedAt: null,
    closedBy: null,
    closeReason: null,
  }

  it('an established correspondence\'s old ordinary quill letter (reply_to_id=null) is NOT effectively expired', () => {
    expect(isEffectivelyExpired(OLD_SENT_ROOT, true)).toBe(false)
  })

  it('a genuinely unestablished first-contact letter past 72h IS effectively expired', () => {
    expect(isEffectivelyExpired(OLD_SENT_ROOT, false)).toBe(true)
  })

  it('never expired while fresh, regardless of establishment', () => {
    const fresh: Letter = { ...OLD_SENT_ROOT, expiresAt: new Date(Date.now() + 60_000).toISOString() }
    expect(isEffectivelyExpired(fresh, false)).toBe(false)
    expect(isEffectivelyExpired(fresh, true)).toBe(false)
  })

  it('already-replied letters are never "expired" either way (status gate unchanged)', () => {
    const replied: Letter = { ...OLD_SENT_ROOT, status: 'replied' }
    expect(isEffectivelyExpired(replied, false)).toBe(false)
    expect(isEffectivelyExpired(replied, true)).toBe(false)
  })
})

describe('end-to-end: an established reader never shows first-contact expiry/close UI merely because a letter is old', () => {
  it('mirrors the exact page.tsx computation chain for an old, established, ordinary quill letter', () => {
    const oldOrdinaryLetter: Letter = {
      id: 'letter-old',
      senderId: B,
      recipientId: A,
      questionAnswerId: null,
      replyToId: null,
      correspondenceId: 'corr-1',
      body: 'an old ongoing letter',
      status: 'sent',
      createdAt: '2020-01-01T00:00:00Z',
      expiresAt: '2020-01-04T00:00:00Z',
      isUnread: true,
      repliedAt: null,
      closedAt: null,
      closedBy: null,
      closeReason: null,
    }
    const established = true

    // Exactly the same derivation order as app/letters/[letterId]/page.tsx.
    const targetExpired = isEffectivelyExpired(oldOrdinaryLetter, established)
    const targetEffectiveStatus = targetExpired ? 'closed' : oldOrdinaryLetter.status
    const isFirstContactLetter = oldOrdinaryLetter.replyToId === null
    const isRecipientOfTarget = oldOrdinaryLetter.recipientId === A

    const { showFirstContactResponse, showWriteQuill } = resolveLetterActionState(
      established,
      isFirstContactLetter,
      isRecipientOfTarget,
      targetEffectiveStatus
    )

    expect(targetEffectiveStatus).toBe('sent') // never falsely 'closed'
    expect(showFirstContactResponse).toBe(false) // no Close this letter / Accept UI
    expect(showWriteQuill).toBe(true) // the persistent quill is what shows
    expect(shouldMarkLetterOpened(oldOrdinaryLetter, A)).toBe(true) // still markable as read
  })
})

describe('resolveReplyToId', () => {
  it('12. the quill path (no replyTo requested) resolves to null — the same composer, without context', () => {
    expect(resolveReplyToId(undefined, null, 'corr-1')).toBeNull()
    expect(resolveReplyToId(null, null, 'corr-1')).toBeNull()
  })

  it('resolves a genuine same-correspondence letter', () => {
    expect(resolveReplyToId('letter-1', { id: 'letter-1', correspondenceId: 'corr-1' }, 'corr-1')).toBe('letter-1')
  })

  it('rejects a letter from a different correspondence, degrading to a plain quill compose', () => {
    expect(resolveReplyToId('letter-1', { id: 'letter-1', correspondenceId: 'corr-OTHER' }, 'corr-1')).toBeNull()
  })

  it('rejects a requested id that could not be found at all', () => {
    expect(resolveReplyToId('missing-letter', null, 'corr-1')).toBeNull()
  })
})
