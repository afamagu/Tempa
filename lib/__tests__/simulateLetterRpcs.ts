// Pure, in-memory simulations of send_first_letter / reply_to_letter's
// actual INSERT value assignments for sender_id/recipient_id.
//
// NOT live code the app calls — the real creation path is the Postgres
// RPCs themselves (docs/sql/2026-08-30-letters.sql,
// docs/sql/2026-08-31-correspondences.sql,
// docs/sql/2026-09-01-letter2-moments-gate-fix.sql), which this
// repository cannot execute in a test run. These mirror those RPCs'
// verified INSERT statements byte-for-byte on the columns that matter
// here (every revision of reply_to_letter checked — all three insert
// identically: `sender_id = auth.uid(), recipient_id = original.sender_id`),
// so the creation CONTRACT is under test, not only the
// retrieval/display layer (resolveLetterDirection). If a future SQL
// change to either RPC's sender_id/recipient_id assignment ever drifts
// from what's asserted against these simulations, that drift has to be
// made deliberately here too — it can't happen silently.

export type SimulatedLetter = {
  id: string
  senderId: string
  recipientId: string
  replyToId: string | null
}

let nextId = 0
function freshId(): string {
  nextId += 1
  return `letter-${nextId}`
}

/** Mirrors send_first_letter's INSERT:
 *    sender_id    = auth.uid()
 *    recipient_id = p_recipient_id
 */
export function simulateSendFirstLetter(authUid: string, recipientId: string): SimulatedLetter {
  return { id: freshId(), senderId: authUid, recipientId, replyToId: null }
}

/** Mirrors reply_to_letter's WHERE guard (`recipient_id = auth.uid()`,
 * i.e. only the original's actual recipient may reply) and its INSERT:
 *    sender_id    = auth.uid()
 *    recipient_id = original.sender_id
 */
export function simulateReplyToLetter(authUid: string, original: SimulatedLetter): SimulatedLetter {
  if (original.recipientId !== authUid) {
    throw new Error('Letter not found, not addressed to you, or no longer awaiting a reply.')
  }
  return { id: freshId(), senderId: authUid, recipientId: original.senderId, replyToId: original.id }
}
