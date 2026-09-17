// Pure, in-memory simulations of the Write Anytime SQL — the exact
// validation/authorization order performed by reply_to_letter's
// established_at branch (docs/sql/2026-09-03-reply-to-letter-established-at.sql),
// write_letter (docs/sql/2026-09-03-write-letter-rpc.sql), and the
// one-time established_at backfill
// (docs/sql/2026-09-03-correspondence-established-at.sql).
//
// NOT live code the app calls — this repository cannot execute these
// live Postgres RPCs/migrations in a test run. These mirror their real
// logic byte-for-byte (same checks, same order) so the CONTRACT is
// under test, not only the display layer. If a future SQL change ever
// drifts from what's asserted against these simulations, that drift
// has to be made deliberately here too — it can't happen silently.

export type SimCorrespondence = {
  id: string
  participantLow: string
  participantHigh: string
  status: 'active' | 'closed'
  establishedAt: string | null
  photoConsentStatus: 'no_request' | 'pending' | 'deferred' | 'enabled' | 'photo_free'
}

export type SimLetter = {
  id: string
  senderId: string
  recipientId: string
  replyToId: string | null
  correspondenceId: string
  status: 'sent' | 'replied' | 'closed'
}

let nextId = 0
function freshId(prefix: string): string {
  nextId += 1
  return `${prefix}-${nextId}`
}

/** Mirrors reply_to_letter's `if is_first_reply` branch: established_at
 * is set exactly once, on the first reply, coalesced so a later call
 * can never overwrite it — matches migration
 * 2026-09-03-reply-to-letter-established-at.sql. */
export function simulateFirstReplyEstablishment(
  correspondence: SimCorrespondence,
  isFirstReply: boolean,
  now: string
): SimCorrespondence {
  if (!isFirstReply) return { ...correspondence }
  return {
    ...correspondence,
    status: 'active',
    establishedAt: correspondence.establishedAt ?? now,
  }
}

/** Mirrors reply_to_letter's unchanged Moments gate: Letter 2
 * (is_first_reply) never carries Moments — the Letter 1/2 text-only
 * rule holds regardless of Write Anytime. */
export function momentsAllowedOnReply(isFirstReply: boolean): boolean {
  return !isFirstReply
}

/** Mirrors the one-time established_at backfill's evidence rule: a
 * correspondence is established only if its root letter (reply_to_id
 * null) has an actual reply (a letter whose reply_to_id points at it)
 * — established_at becomes that reply's created_at, never now(), never
 * guessed for a correspondence with only its root letter. */
export function simulateEstablishedAtBackfill(
  letters: { id: string; replyToId: string | null; createdAt: string }[]
): string | null {
  const root = letters.find((l) => l.replyToId === null)
  if (!root) return null
  const replies = letters.filter((l) => l.replyToId === root.id)
  if (replies.length === 0) return null
  return [...replies].map((r) => r.createdAt).sort()[0]
}

export type SimLetterRow = {
  correspondenceId: string
  senderId: string
  recipientId: string
  replyToId: string | null
  deliverAt: string
  /** Only required for simulateMomentsQualifiedForViewer, which must
   * find the ONE letter whose createdAt equals the correspondence's
   * own establishedAt — see that function's own doc comment. Omit for
   * callers (e.g. simulateIncomingMailInTransit) that don't need it. */
  createdAt?: string
}

/** Mirrors moments_qualified_for_viewer's exact CASE structure and
 * predicate (docs/sql/2026-09-04-mail-call-moments-qualified.sql):
 *
 *   1. viewerId === null (unauthenticated)              -> false
 *   2. viewer is not a correspondence participant        -> false
 *   3. else: the letter whose createdAt === correspondence.establishedAt
 *      (the ONE letter reply_to_letter's own
 *      established_at = coalesce(established_at, now()) proves is the
 *      letter that actually established this correspondence — see
 *      that migration's own doc comment for the transaction-stable-
 *      now() proof) must have deliverAt <= now.
 *
 * Deliberately NOT "any reply-type letter" or "the reply with the
 * minimum createdAt": a correspondence can carry a second, genuinely
 * independent reply-type row (the crossed-root case — a reply to the
 * OTHER original first-contact letter, still reachable via
 * reply_to_letter even after establishment through the first root)
 * whose own createdAt is later and therefore never equals the frozen
 * establishedAt, however early its own deliverAt happens to land.
 * Takes `now` as an explicit parameter rather than reading the real
 * clock — mirrors the SQL's own now(), never substitutes for it in
 * production code. */
export function simulateMomentsQualifiedForViewer(
  correspondence: SimCorrespondence,
  letters: SimLetterRow[],
  viewerId: string | null,
  now: string
): boolean {
  if (viewerId === null) return false

  const isParticipant = viewerId === correspondence.participantLow || viewerId === correspondence.participantHigh
  if (!isParticipant) return false

  if (correspondence.establishedAt === null) return false

  const establishingLetter = letters.find((l) => l.createdAt === correspondence.establishedAt)
  if (!establishingLetter) return false

  return establishingLetter.deliverAt <= now
}

/** Mirrors incoming_mail_in_transit's exact predicate
 * (docs/sql/2026-09-04-mail-call-transit-indicator.sql): every
 * distinct (correspondence_id, sender_id) pair where recipient_id =
 * viewer and deliver_at > now — i.e. mail addressed to this viewer
 * that hasn't arrived yet, deduplicated per correspondent the same
 * way `select distinct` does. */
export function simulateIncomingMailInTransit(
  letters: SimLetterRow[],
  viewerId: string,
  now: string
): { correspondenceId: string; otherParticipantId: string }[] {
  const seen = new Set<string>()
  const result: { correspondenceId: string; otherParticipantId: string }[] = []
  for (const l of letters) {
    if (l.recipientId !== viewerId || l.deliverAt <= now) continue
    const key = `${l.correspondenceId}::${l.senderId}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ correspondenceId: l.correspondenceId, otherParticipantId: l.senderId })
  }
  return result
}

export class WriteLetterError extends Error {}

/** Mirrors write_letter's full authorization + validation order:
 * participant membership, correspondence.status/established_at,
 * recipient derivation (always from the pair, never a trusted
 * parameter — there is no such parameter), reply_to_id's
 * same-correspondence check, and the Moments/photo-consent gate —
 * matches docs/sql/2026-09-03-write-letter-rpc.sql line for line.
 * Deliberately never inspects or mutates any OTHER letter's status. */
export function simulateWriteLetter(
  correspondence: SimCorrespondence,
  existingLetters: SimLetter[],
  callerId: string,
  body: string,
  replyToId: string | null,
  moments: { type: 'photo' | 'postcard' }[] = []
): SimLetter {
  if (callerId !== correspondence.participantLow && callerId !== correspondence.participantHigh) {
    throw new WriteLetterError('You are not a participant in this correspondence.')
  }

  if (correspondence.status !== 'active' || correspondence.establishedAt === null) {
    throw new WriteLetterError('This correspondence is not yet established for ongoing letters.')
  }

  const recipientId =
    callerId === correspondence.participantLow ? correspondence.participantHigh : correspondence.participantLow

  if (replyToId !== null) {
    const target = existingLetters.find((l) => l.id === replyToId)
    if (!target || target.correspondenceId !== correspondence.id) {
      throw new WriteLetterError('reply_to_id must reference a letter in this same correspondence.')
    }
  }

  const hasPhoto = moments.some((m) => m.type === 'photo')
  if (hasPhoto && !['no_request', 'enabled'].includes(correspondence.photoConsentStatus)) {
    throw new WriteLetterError('Photo sharing is not available in this correspondence right now.')
  }

  return {
    id: freshId('letter'),
    senderId: callerId,
    recipientId,
    replyToId,
    correspondenceId: correspondence.id,
    status: 'sent',
  }
}

export class PostcardValidationError extends Error {}

export type SimPostcardCatalogEntry = { key: string; isActive: boolean }
export type SimPostcardVersion = { postcardKey: string; isCurrent: boolean }

/** Admin Phase 2A-2 — mirrors the identical p_postcard validation block
 * duplicated verbatim in both write_letter and reply_to_letter
 * (docs/sql/2026-09-14-letter-level-postcards.sql, ~lines 649-706 and
 * ~981-1013): same order, same messages. Resolves the current version
 * for the given key and returns the trimmed payload on success; throws
 * on the FIRST failing check, matching the SQL's own early-exit `raise
 * exception` order exactly. Returns null when no Postcard was
 * attempted at all (p_postcard is null), mirroring `has_postcard :=
 * p_postcard is not null`. Deliberately does not model the surrounding
 * moments_qualified_for_viewer/account-status gates — those are
 * already covered by simulateMomentsQualifiedForViewer and this
 * codebase's own account-status simulators elsewhere; this function is
 * scoped purely to the Postcard-specific validation the live migration
 * introduced. */
export function simulatePostcardValidation(
  catalog: SimPostcardCatalogEntry[],
  versions: SimPostcardVersion[],
  postcard: { postcardKey: string | null; revealLine: string | null; backMessage: string | null } | null
): { postcardKey: string; revealLine: string | null; backMessage: string } | null {
  if (postcard === null) return null

  const key = postcard.postcardKey
  if (key === null || key.trim().length === 0) {
    throw new PostcardValidationError('A Postcard requires a postcard key.')
  }

  if (!catalog.some((c) => c.key === key && c.isActive)) {
    throw new PostcardValidationError('Unknown postcard.')
  }

  const currentVersion = versions.find((v) => v.postcardKey === key && v.isCurrent)
  if (!currentVersion) {
    throw new PostcardValidationError('This postcard has no current version available.')
  }

  if (postcard.revealLine !== null && postcard.revealLine.length > 32) {
    throw new PostcardValidationError("A Postcard's Reveal Line is too long.")
  }

  const trimmedBackMessage = (postcard.backMessage ?? '').trim()
  if (trimmedBackMessage.length === 0) {
    throw new PostcardValidationError('A Postcard needs its own written message before it can be sent.')
  }
  // Smoke-test contract completion checkpoint: 200 -> 300.
  if (trimmedBackMessage.length > 300) {
    throw new PostcardValidationError("A Postcard's back message is too long.")
  }

  return { postcardKey: key, revealLine: postcard.revealLine, backMessage: trimmedBackMessage }
}
