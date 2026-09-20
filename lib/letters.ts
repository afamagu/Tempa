import type { SupabaseClient } from '@supabase/supabase-js'
import type { Moment, MomentType, PostcardBaseContent, PostcardRevealLineAlignment } from './moments'
import { splitParagraphs } from './moments'
import { stripRichBodyMarker } from './letter-editor-doc'
import { publicProfileMarkUrl } from './profile-marks'

export type LetterStatus = 'sent' | 'replied' | 'closed'
export type ClosedBy = 'recipient' | 'system'

export type Letter = {
  id: string
  senderId: string
  recipientId: string
  questionAnswerId: string | null
  replyToId: string | null
  correspondenceId: string
  body: string
  status: LetterStatus
  createdAt: string
  expiresAt: string
  /**
   * True only when the current viewer is this letter's recipient and it
   * hasn't been opened yet. Sourced from letters_for_participant, which
   * never exposes the underlying opened_at timestamp to any client — a
   * sender viewing their own sent letter always sees this as false, not
   * because it's hidden from them specifically, but because the raw
   * value never leaves the database in the first place. See
   * docs/sql/2026-08-30-letters.sql.
   */
  isUnread: boolean
  repliedAt: string | null
  closedAt: string | null
  closedBy: ClosedBy | null
  closeReason: string | null
}

export type LetterDirection = { senderName: string; recipientName: string }

/**
 * The sender/recipient names for ONE letter's header — always resolved
 * directly from that letter's own sender_id/recipient_id against a
 * profile-pseudonym lookup, never from the current viewer, who
 * initiated the correspondence, who owns the Letterbox, or which letter
 * is newest/latest. Every one of those is a property of the VIEWER or
 * the CORRESPONDENCE, not of this individual letter — a fixed, sent
 * message has an objective direction that cannot depend on who happens
 * to be looking at it. `pseudonymById` only needs to contain the two
 * participants' own ids for this to be exhaustive for any letter in a
 * given correspondence — every letter's sender_id/recipient_id is
 * necessarily one of those two people (see lib/letters.test.ts for the
 * full case matrix, including that reply direction alternates per
 * letter and that this never depends on which one is "target" /
 * currently expanded / most recent).
 */
export function resolveLetterDirection(
  letter: Pick<Letter, 'senderId' | 'recipientId'>,
  pseudonymById: Map<string, string>
): LetterDirection {
  return {
    senderName: pseudonymById.get(letter.senderId) ?? 'A member',
    recipientName: pseudonymById.get(letter.recipientId) ?? 'A member',
  }
}

/**
 * Pure: the beginning of a letter body, safe for a compact Letterbox
 * preview card (Level 1's PeopleGrid, Level 2's ArchiveList) — the
 * first paragraph only, via the same blank-line convention
 * (splitParagraphs, lib/moments.ts) used everywhere else a letter is
 * split into paragraphs. Deliberately paragraph-aware, never a raw
 * character slice — a preview card must read as "the start of this
 * letter," not an arbitrary cut that can land mid-sentence or, worse,
 * spill into a second paragraph and grow the card to match. This is
 * presentation only: it never mutates or truncates the stored body,
 * which every caller still holds in full (letter.body /
 * person.latestExcerpt) — the individual reader always renders that
 * untouched value. Callers still apply CSS line-clamping on top of
 * this (never rely on paragraph-extraction alone), since even one
 * paragraph can run past two visual lines. Strips the rich-body marker
 * (see lib/letter-editor-doc.ts's stripRichBodyMarker) BEFORE splitting
 * into paragraphs — the marker only ever sits at position 0 of the
 * WHOLE body, so it must never leak into the returned preview text.
 * Callers that go on to render this through FormattedText must pair it
 * with isRichBody(body) — called against the SAME raw body, not this
 * function's already-extracted return value — to know whether that
 * preview text is safe to run through mark-decoding at all.
 */
export function letterPreviewText(body: string): string {
  const { body: clean } = stripRichBodyMarker(body)
  return splitParagraphs(clean)[0] ?? ''
}

/**
 * Pure: whether `body` (a raw letters.body value) was produced by the
 * rich Bold/Italic encoder — see stripRichBodyMarker's own doc comment
 * for why this determination must be made once against the whole body
 * rather than per-paragraph. A historical letter, or any letter that
 * simply used no formatting, is never rich; FormattedText must never
 * attempt mark-decoding on it, regardless of what characters it
 * contains.
 */
export function isRichBody(body: string): boolean {
  return stripRichBodyMarker(body).isRich
}

// Human-selected reasons only — "Something else" was removed for V1 (see
// build guide: it would need its own moderation surface for a
// rejection-adjacent free-text field, out of scope here). Automatic
// expiry never uses one of these; it's its own closedBy = 'system' state
// with close_reason left null, never a fabricated human reason.
export const CLOSE_REASONS = [
  "I can't take on another correspondence right now.",
  "I don't think we're the right correspondence.",
  "I'm taking a break from new letters.",
] as const

export type CloseReason = (typeof CLOSE_REASONS)[number]

type LetterRow = {
  id: string
  sender_id: string
  recipient_id: string
  question_answer_id: string | null
  reply_to_id: string | null
  correspondence_id: string
  body: string
  status: LetterStatus
  created_at: string
  expires_at: string
  is_unread: boolean
  replied_at: string | null
  closed_at: string | null
  closed_by: ClosedBy | null
  close_reason: string | null
}

function toLetter(row: LetterRow): Letter {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    questionAnswerId: row.question_answer_id,
    replyToId: row.reply_to_id,
    correspondenceId: row.correspondence_id,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    isUnread: row.is_unread,
    repliedAt: row.replied_at,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    closeReason: row.close_reason,
  }
}

// Reads go through letters_for_participant, never the letters table
// directly — that view is what actually keeps opened_at from ever
// reaching a sender (see docs/sql/2026-08-30-letters.sql). There is no
// opened_at column to select here at all, by design.
const LETTERS_VIEW = 'letters_for_participant'
const LETTER_COLUMNS =
  'id, sender_id, recipient_id, question_answer_id, reply_to_id, correspondence_id, body, status, created_at, expires_at, is_unread, replied_at, closed_at, closed_by, close_reason'

/**
 * True once a GENUINELY UNESTABLISHED first-contact letter's 72-hour
 * response window has passed while it's still nominally "sent" — i.e.
 * the scheduled expiry job (see docs/sql/2026-08-30-letters.sql) hasn't
 * processed it yet. Display code treats this the same as an
 * already-system-closed letter, so the product stays honest even
 * before that job exists or has run recently.
 *
 * `reply_to_id === null` alone is NOT sufficient to identify a genuine
 * first-contact letter: Write Anytime's quill sends ordinary letters
 * with reply_to_id = null too (see write_letter's p_reply_to_id
 * default). Without the `established` guard, any old quill-sent letter
 * would be wrongly treated as an expired, unaccepted first contact —
 * suppressing MarkLetterOpened (read state must never depend on
 * action/expiry status) and showing a false "closed... reply window"
 * message. `established` must come from the letter's own
 * correspondence (correspondence.establishedAt !== null) — an
 * established correspondence can never have ANY of its ordinary
 * letters treated as an expired first contact, regardless of age.
 */
export function isEffectivelyExpired(letter: Letter, established: boolean): boolean {
  return (
    !established &&
    letter.replyToId === null &&
    letter.status === 'sent' &&
    new Date(letter.expiresAt).getTime() <= Date.now()
  )
}

/**
 * Pure: Home's unread-arrival list — every delivered, visible letter
 * this viewer received and has not opened yet. `letters` is always
 * sourced from getMyLetters (letters_for_participant), so isUnread is
 * the participant-safe projection of opened_at and an undelivered
 * incoming letter never appears in this function's input. Letter
 * lifecycle status is deliberately irrelevant: Home's "letter waiting"
 * language describes unread mail, not whether a letter awaits a reply.
 */
export function deriveArrivals(letters: Letter[], userId: string): Letter[] {
  return letters.filter((l) => l.recipientId === userId && l.isUnread)
}

/**
 * Pure: the entire "mark this letter opened" gate — viewer is the
 * recipient AND the letter is currently unread. Deliberately takes no
 * status/expiry input at all: read state must be independent of
 * whatever action state a letter is in (sent, replied, or otherwise
 * non-actionable) — an established, already-replied, or ordinary
 * Write-Anytime letter is exactly as markable-as-read as a fresh one.
 */
export function shouldMarkLetterOpened(
  letter: { recipientId: string; isUnread: boolean },
  viewerId: string
): boolean {
  return letter.recipientId === viewerId && letter.isUnread
}

/**
 * The original first-contact letter (reply_to_id is null) from sender to
 * recipient, if one has ever been sent — regardless of its resolution.
 * A sender can have at most one of these per recipient, enforced by a
 * partial unique index in the database, so this never needs disambiguation.
 */
export async function getFirstContact(
  supabase: SupabaseClient,
  senderId: string,
  recipientId: string
): Promise<Letter | null> {
  const { data } = await supabase
    .from(LETTERS_VIEW)
    .select(LETTER_COLUMNS)
    .eq('sender_id', senderId)
    .eq('recipient_id', recipientId)
    .is('reply_to_id', null)
    .maybeSingle()

  return data ? toLetter(data as LetterRow) : null
}

/** A single letter by id. The view already restricts this to its two participants. */
export async function getLetterById(
  supabase: SupabaseClient,
  letterId: string
): Promise<Letter | null> {
  const { data } = await supabase
    .from(LETTERS_VIEW)
    .select(LETTER_COLUMNS)
    .eq('id', letterId)
    .maybeSingle()

  return data ? toLetter(data as LetterRow) : null
}

/** The direct reply to a letter, if one has been sent. At most one can
 * ever exist, since a letter can only be replied to while status = 'sent'. */
export async function getReplyTo(
  supabase: SupabaseClient,
  letterId: string
): Promise<Letter | null> {
  const { data } = await supabase
    .from(LETTERS_VIEW)
    .select(LETTER_COLUMNS)
    .eq('reply_to_id', letterId)
    .maybeSingle()

  return data ? toLetter(data as LetterRow) : null
}

/**
 * How many letters this member has never opened — the count shown as
 * a badge in navigation. Driven by is_unread (opened_at is null),
 * never by status. Under Write Anytime an ordinary letter's status
 * stays 'sent' forever (see write_letter) rather than transitioning
 * the way a first-contact letter's does, so a status='sent' count
 * would grow without bound and never reflect that something was
 * actually read — is_unread is the only signal that still means "the
 * member hasn't looked at this yet." A lightweight head-count query
 * (no rows fetched) rather than reusing getMyLetters, since this runs
 * on every authenticated page that shows the nav shell.
 */
export async function getWaitingLetterCount(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const { count } = await supabase
    .from(LETTERS_VIEW)
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', userId)
    .eq('is_unread', true)

  return count ?? 0
}

/**
 * Every letter this member sent or received, newest first. Callers
 * partition this into "awaiting reply" vs "resolved" themselves using
 * isEffectivelyExpired — a single query this way stays correct even for
 * a first-contact letter whose 72-hour window has passed but the
 * scheduled expiry job hasn't processed yet, rather than that letter
 * disappearing from both lists until the job runs.
 */
export async function getMyLetters(
  supabase: SupabaseClient,
  userId: string
): Promise<Letter[]> {
  const { data } = await supabase
    .from(LETTERS_VIEW)
    .select(LETTER_COLUMNS)
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('created_at', { ascending: false })

  return (data ?? []).map((row) => toLetter(row as LetterRow))
}

/**
 * Pure: getMyLetters' result with every hidden correspondence's
 * letters removed. "Remove from my Letterbox" means that
 * correspondence should no longer surface in this viewer's ordinary
 * personal mail surfaces at all, not just the Letterbox screen itself
 * — so Home's Arrivals must apply the exact same hiddenCorrespondenceIds
 * set Letterbox already fetches (getHiddenCorrespondenceIds) rather
 * than a second hiding mechanism or a duplicated query.
 */
export function excludeHiddenLetters(letters: Letter[], hiddenCorrespondenceIds: Set<string>): Letter[] {
  return letters.filter((l) => !hiddenCorrespondenceIds.has(l.correspondenceId))
}

/**
 * Every letter in one correspondence episode, oldest first — the
 * reader's thread view is built from this single call rather than one
 * request per letter.
 */
export async function getLettersForCorrespondence(
  supabase: SupabaseClient,
  correspondenceId: string
): Promise<Letter[]> {
  const { data } = await supabase
    .from(LETTERS_VIEW)
    .select(LETTER_COLUMNS)
    .eq('correspondence_id', correspondenceId)
    .order('created_at', { ascending: true })

  return (data ?? []).map((row) => toLetter(row as LetterRow))
}

// ============================================================
// CORRESPONDENCES — one row per continuous episode, not per pair.
// See docs/sql/2026-08-31-correspondences.sql and
// docs/tempa-build-guide.md for the product rule this encodes.
// ============================================================

export type PhotoConsentStatus = 'no_request' | 'pending' | 'deferred' | 'enabled' | 'photo_free'

/**
 * The ONE shared definition of "does this specific user have an
 * outstanding photo-sharing decision to make, right now" — reused by
 * the Letterbox indicator, PhotoConsent, and the composer's blocked-
 * photo message, so those three surfaces can never again drift apart
 * (as they did: only 'pending' got a route back to the locked photo,
 * leaving 'deferred' — which is just as unresolved — with none at all).
 *
 * Deliberately narrow, per current product rules:
 *   - 'pending'  — outstanding for whoever is NOT photo_consent_requested_by
 *                  (the requester is waiting, not deciding).
 *   - 'deferred' — outstanding for whoever IS photo_consent_resolved_by
 *                  (the person who chose "Maybe later" — respond_photo_sharing
 *                  forbids the requester from ever being resolvedBy, so this
 *                  is never the requester). The requester side of 'deferred'
 *                  gets an informational message elsewhere, not this flag.
 *   - 'photo_free' — explicitly NOT outstanding for anyone. It's a resolved
 *                    state; the resolver's reconsideration is a deliberate,
 *                    separate action (LockedPhotoMoment's "Ask about
 *                    photos"), never something the UI should keep pushing
 *                    them back toward.
 *   - 'no_request' / 'enabled' — never outstanding; nothing to decide.
 */
export function isPhotoDecisionOutstandingForUser(
  consent: { status: PhotoConsentStatus; requestedBy: string | null; resolvedBy: string | null },
  userId: string
): boolean {
  if (consent.status === 'pending') return consent.requestedBy !== userId
  if (consent.status === 'deferred') return consent.resolvedBy === userId
  return false
}

/**
 * Whether this user may reconsider a resolved 'photo_free' choice —
 * true only for whoever actually made that choice
 * (photo_consent_resolved_by). photo_free is a deliberate boundary one
 * participant set; the other participant must never be offered a way
 * to reopen it themselves — the live request_photo_sharing RPC already
 * enforces this server-side (its photo_free branch requires
 * resolved_by = auth.uid()), and this is the same check on the display
 * side, kept as its own named, testable function rather than an inline
 * comparison so the two can't quietly drift apart.
 */
export function canReconsiderPhotoFree(
  consent: { status: PhotoConsentStatus; resolvedBy: string | null },
  userId: string
): boolean {
  return consent.status === 'photo_free' && consent.resolvedBy === userId
}

// The live, authoritative correspondence lifecycle (see
// docs/sql/2026-08-31-correspondences.sql's correspondences_status_check):
// only two values exist, there is no separate 'pending' status.
//   active  — the episode is open: set the moment the row is created
//             (Letter 1 sent, no reply yet), and remains 'active'
//             through any ongoing back-and-forth. Moments eligibility
//             keys off is_first_reply inside reply_to_letter (see
//             docs/sql/2026-09-01-letter2-moments-gate-fix.sql), never
//             off this column.
//   closed  — the episode ended (a first-contact letter closed or
//             expired before any reply — see docs/tempa-build-guide.md).
export type CorrespondenceStatus = 'active' | 'closed'

export type Correspondence = {
  id: string
  participantLow: string
  participantHigh: string
  status: CorrespondenceStatus
  createdAt: string
  closedAt: string | null
  /** Set exactly once, the moment this correspondence's first reply
   * lands (see reply_to_letter) — null means "first contact sent, not
   * yet accepted." status alone can't tell these apart: it's already
   * 'active' from the moment the correspondence row is created. This is
   * the sole authorization signal for Write Anytime (write_letter) and
   * for Moments eligibility. */
  establishedAt: string | null
  photoConsentStatus: PhotoConsentStatus
  photoConsentRequestedBy: string | null
  photoConsentRequestedAt: string | null
  photoConsentResolvedBy: string | null
  photoConsentResolvedAt: string | null
}

type CorrespondenceRow = {
  id: string
  participant_low: string
  participant_high: string
  status: CorrespondenceStatus
  created_at: string
  closed_at: string | null
  established_at: string | null
  photo_consent_status: PhotoConsentStatus
  photo_consent_requested_by: string | null
  photo_consent_requested_at: string | null
  photo_consent_resolved_by: string | null
  photo_consent_resolved_at: string | null
}

function toCorrespondence(row: CorrespondenceRow): Correspondence {
  return {
    id: row.id,
    participantLow: row.participant_low,
    participantHigh: row.participant_high,
    status: row.status,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    establishedAt: row.established_at,
    photoConsentStatus: row.photo_consent_status,
    photoConsentRequestedBy: row.photo_consent_requested_by,
    photoConsentRequestedAt: row.photo_consent_requested_at,
    photoConsentResolvedBy: row.photo_consent_resolved_by,
    photoConsentResolvedAt: row.photo_consent_resolved_at,
  }
}

const CORRESPONDENCE_COLUMNS =
  'id, participant_low, participant_high, status, created_at, closed_at, established_at, photo_consent_status, photo_consent_requested_by, photo_consent_requested_at, photo_consent_resolved_by, photo_consent_resolved_at'

export async function getCorrespondence(
  supabase: SupabaseClient,
  correspondenceId: string
): Promise<Correspondence | null> {
  const { data } = await supabase
    .from('correspondences')
    .select(CORRESPONDENCE_COLUMNS)
    .eq('id', correspondenceId)
    .maybeSingle()

  return data ? toCorrespondence(data as CorrespondenceRow) : null
}

/**
 * The one active correspondence episode between the viewer and
 * otherUserId whose DATABASE established_at is already set, if any —
 * a NECESSARY but not sufficient condition for Write Anytime. This is
 * a candidate lookup only, not an authorization decision: established_at
 * is a correspondence-level, viewer-agnostic fact that can be true here
 * before Mail Call has actually delivered the reply that set it to
 * whichever party didn't send it. Callers that use this to gate access
 * to Write Anytime MUST also confirm isEstablishedForViewer (below) —
 * see app/letters/with/[userId]/write/page.tsx. Deliberately distinct
 * from getLetterArchiveWithUser's multi-episode/historical scope: this
 * never returns a closed episode, and never returns an episode still
 * awaiting its first reply (established_at null) at all — neither may
 * receive an ordinary write_letter call regardless of viewer. Returns
 * null rather than falling back to anything — the caller must never
 * create a correspondence or redirect into first-contact composition
 * here.
 */
export async function getActiveEstablishedCorrespondenceWithUser(
  supabase: SupabaseClient,
  userId: string,
  otherUserId: string
): Promise<Correspondence | null> {
  const participantLow = userId < otherUserId ? userId : otherUserId
  const participantHigh = userId < otherUserId ? otherUserId : userId

  const { data } = await supabase
    .from('correspondences')
    .select(CORRESPONDENCE_COLUMNS)
    .eq('participant_low', participantLow)
    .eq('participant_high', participantHigh)
    .eq('status', 'active')
    .not('established_at', 'is', null)
    .maybeSingle()

  return data ? toCorrespondence(data as CorrespondenceRow) : null
}

/**
 * Whether THIS viewer — the client's own authenticated caller, never a
 * passed-in user id, since letters_for_participant is already scoped
 * to auth.uid() — can currently see at least one reply letter
 * (reply_to_id IS NOT NULL) in this correspondence. This, not
 * correspondences.established_at, is the correct signal for anything
 * UI/authorization-visible: established_at is set the instant a reply
 * is SENT, regardless of whether Mail Call has actually delivered it
 * to the party who didn't send it. Its own sender sees it (and
 * therefore this returns true for them) unconditionally and
 * immediately; the other party only once letters_for_participant
 * itself shows it to them. Relies entirely on that view — the single
 * enforced delivery/security boundary — rather than reproducing any
 * deliver_at comparison here.
 *
 * Existence-only: no rows are ever fetched into memory, matching
 * getWaitingLetterCount's head-count style.
 */
export async function isEstablishedForViewer(
  supabase: SupabaseClient,
  correspondenceId: string
): Promise<boolean> {
  const { count } = await supabase
    .from(LETTERS_VIEW)
    .select('id', { count: 'exact', head: true })
    .eq('correspondence_id', correspondenceId)
    .not('reply_to_id', 'is', null)
    .limit(1)

  return (count ?? 0) > 0
}

/**
 * Whether Moments (photo/postcard attachments) are available in this
 * correspondence for THIS viewer — distinct from, and stricter than,
 * isEstablishedForViewer. established_at merely means a reply was
 * SENT; the Letter 1/2 text-only, Letter 3+ Moments-eligible rule
 * requires that reply to have actually DELIVERED (deliver_at <=
 * now()), for BOTH participants — the Letter-2 sender may already be
 * writing Letter 3, 4, 5... back-to-back while Letter 2 is still
 * travelling, and those stay text-only until Letter 2 itself arrives.
 *
 * letters_for_participant cannot answer this on its own: it never
 * selects deliver_at at all. Calls the moments_qualified_for_viewer
 * RPC (docs/sql/2026-09-04-mail-call-moments-qualified.sql) instead of
 * reproducing that comparison against a client-supplied clock — the
 * database's own now() is the only thing that decides this. Fails
 * closed (false) on any RPC error, never granting Moments on an
 * inconclusive check.
 */
export async function isMomentsQualifiedForViewer(
  supabase: SupabaseClient,
  correspondenceId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('moments_qualified_for_viewer', {
    p_correspondence_id: correspondenceId,
  })

  if (error) {
    console.error('[letters] moments_qualified_for_viewer failed', {
      message: error.message,
      code: error.code,
      correspondenceId,
    })
    return false
  }

  return data === true
}

/** One letter currently travelling toward this viewer — existence
 * only, sourced from the incoming_mail_in_transit RPC. Deliberately
 * carries no letter id, no deliver_at, no status/body/moments — see
 * that RPC's own doc comment (docs/sql/2026-09-04-mail-call-transit-
 * indicator.sql) for the full list of what it refuses to expose. */
export type IncomingMailInTransit = {
  correspondenceId: string
  otherParticipantId: string
}

type IncomingMailInTransitRow = {
  correspondence_id: string
  other_participant_id: string
}

/**
 * Every piece of mail currently travelling TOWARD this viewer — one
 * batched RPC call that serves both Home ("is there any at all",
 * hasIncomingMailInTransit) and Letterbox Level 1 ("which correspondent
 * cards get the indicator", incomingMailInTransitPersonIds), never a
 * query per person. letters_for_participant cannot serve this: its
 * whole point is hiding an undelivered incoming letter, so this is a
 * separate, deliberately narrow RPC that reveals ONLY that something
 * is travelling and from whom — never its content or any detail
 * derived from it. Fails to an empty list (nothing shown) on any RPC
 * error, never surfacing an error as if it were "nothing travelling."
 */
export async function getIncomingMailInTransit(
  supabase: SupabaseClient
): Promise<IncomingMailInTransit[]> {
  const { data, error } = await supabase.rpc('incoming_mail_in_transit')

  if (error) {
    console.error('[letters] incoming_mail_in_transit failed', { message: error.message, code: error.code })
    return []
  }

  return ((data ?? []) as IncomingMailInTransitRow[]).map((row) => ({
    correspondenceId: row.correspondence_id,
    otherParticipantId: row.other_participant_id,
  }))
}

/** Pure: Home's "show the Mail on the way indicator at all" check. */
export function hasIncomingMailInTransit(rows: IncomingMailInTransit[]): boolean {
  return rows.length > 0
}

/** Pure: the set of correspondent ids Letterbox Level 1 should attach
 * the indicator to — a Set so multiple travelling letters from the
 * same correspondent collapse into the one card they belong on. */
export function incomingMailInTransitPersonIds(rows: IncomingMailInTransit[]): Set<string> {
  return new Set(rows.map((r) => r.otherParticipantId))
}

/**
 * Pure: same hidden-correspondence principle as excludeHiddenLetters,
 * applied to mail-in-transit rows — a hidden correspondence's
 * travelling letter must not surface as "Mail on the way" on Home
 * either, since that correspondence should no longer appear in this
 * viewer's ordinary personal mail surfaces at all.
 */
export function excludeHiddenMailInTransit(
  rows: IncomingMailInTransit[],
  hiddenCorrespondenceIds: Set<string>
): IncomingMailInTransit[] {
  return rows.filter((r) => !hiddenCorrespondenceIds.has(r.correspondenceId))
}

/**
 * The first-contact status page's (app/write/[recipientId]/page.tsx)
 * display status for the sender's OWN root letter — downgrades a raw
 * DB status of 'replied' back to 'sent' whenever this viewer cannot
 * yet actually see the reply that caused it (isEstablishedForViewer).
 * `status` flips to 'replied' the instant Letter 2 is SENT, not once
 * Mail Call has delivered it; this closes that gap for that one
 * screen. Pure so the downgrade rule itself can be tested without a
 * database.
 */
export function resolveFirstContactDisplayStatus(
  rawStatus: LetterStatus,
  establishedForViewer: boolean
): LetterStatus {
  if (rawStatus === 'replied' && !establishedForViewer) return 'sent'
  return rawStatus
}

/**
 * Whether an already viewer-scoped list of letters (sourced from
 * letters_for_participant — e.g. getMyLetters) shows any correspondence
 * this viewer can currently see has been replied to. Deliberately
 * checks for the presence of a visible reply letter itself
 * (replyToId !== null) rather than a root letter's own `status`
 * field, which flips to 'replied' the instant a reply is SENT, before
 * Mail Call has necessarily delivered it to this viewer. Since the
 * input list is already delivery-gated (a reply only ever appears in
 * it once this viewer can see it), no further query is needed — this
 * is the same fact isEstablishedForViewer answers, derived from data
 * the caller (app/home/page.tsx) already has in hand.
 */
export function hasVisibleReply(letters: Pick<Letter, 'replyToId'>[]): boolean {
  return letters.some((l) => l.replyToId !== null)
}

/**
 * The first still-locked Photo Moment across every letter in ONE
 * correspondence, oldest first — what a single letter's PhotoConsent
 * "Review photo" action needs to link to, even when the locked photo
 * actually lives on a different letter than the one currently open.
 * Deliberately scoped to just this correspondence (photo consent
 * itself is a correspondence-level concept) and to letter ids + Moment
 * presence only — never fetches or renders every letter's body, so
 * the individual-letter reader can stay individual-only while still
 * answering this one cross-letter question.
 */
export async function getFirstLockedPhotoLetterMoment(
  supabase: SupabaseClient,
  correspondenceId: string
): Promise<{ letterId: string; momentId: string } | null> {
  const { data } = await supabase
    .from(LETTERS_VIEW)
    .select('id')
    .eq('correspondence_id', correspondenceId)
    .order('created_at', { ascending: true })

  const letterIds = (data ?? []).map((row) => row.id as string)
  if (letterIds.length === 0) return null

  const momentsByLetterId = await getMomentsForLetters(supabase, letterIds)

  for (const letterId of letterIds) {
    const locked = (momentsByLetterId.get(letterId) ?? []).find(
      (m) => m.type === 'photo' && m.imageUrl === null
    )
    if (locked) return { letterId, momentId: locked.id }
  }
  return null
}

export type LetterActionState = {
  /** The old strict-establishment accept/close flow — only ever true
   * for the un-replied first-contact letter, viewed by its recipient.
   * Mutually exclusive with showWriteQuill BY CONSTRUCTION (not by two
   * independently-computed conditions that could drift): the same
   * write_letter/reply_to_letter transaction that sets established_at
   * also flips the root letter's status to 'replied', so a target
   * letter can never simultaneously be "the pending first-contact
   * letter" and belong to an established correspondence. */
  showFirstContactResponse: boolean
  /** Write Anytime's persistent floating quill — available once the
   * correspondence is established, regardless of which specific letter
   * is open or who sent it (never a per-letter "reply to this one"
   * decision — see the checkpoint that retired the inline Reply link
   * in favor of this one uniform action). */
  showWriteQuill: boolean
}

/**
 * Pure: the single source of truth for which action surface the
 * individual-letter reader shows — extracted specifically so
 * "established" and "pending first contact" can never again be
 * computed as two separate, driftable booleans on the page itself.
 *
 * `established` and `targetEffectiveStatus` come from two separate
 * queries (getCorrespondence / getLetterById), not one atomic read —
 * under concurrent load, the OTHER participant's reply can commit
 * between those two round trips, so a caller could in principle
 * observe established=true while a stale read of the root letter still
 * says 'sent'. `!established` here is a deliberate, explicit guard
 * against exactly that: established always wins, unconditionally, so
 * the two action surfaces can never both show even if their inputs are
 * momentarily inconsistent — proven by exhaustive test, not merely
 * assumed from "this shouldn't happen."
 */
export function resolveLetterActionState(
  established: boolean,
  isFirstContactLetter: boolean,
  isRecipientOfTarget: boolean,
  targetEffectiveStatus: LetterStatus
): LetterActionState {
  return {
    showFirstContactResponse:
      !established && isFirstContactLetter && isRecipientOfTarget && targetEffectiveStatus === 'sent',
    showWriteQuill: established,
  }
}

/**
 * Pure: resolves a `?replyTo=` query param into a real reply_to_id for
 * the write composer — only when it actually names a letter belonging
 * to THIS correspondence. Defense in depth only (write_letter
 * re-validates this itself server-side regardless): a stale, forged,
 * or cross-correspondence id degrades to null (a plain quill compose)
 * rather than being passed through.
 */
export function resolveReplyToId(
  requestedReplyTo: string | null | undefined,
  replyToLetter: { id: string; correspondenceId: string } | null,
  correspondenceId: string
): string | null {
  if (!requestedReplyTo) return null
  if (!replyToLetter || replyToLetter.correspondenceId !== correspondenceId) return null
  return replyToLetter.id
}

/**
 * Every user id the viewer currently has an active correspondence
 * episode with — Explore excludes that person's current answer while
 * that's true. Covers both "sent, no reply yet" and an ongoing
 * back-and-forth, since correspondences.status is 'active' for both (see
 * the CorrespondenceStatus comment above). A closed episode does NOT
 * exclude the person here; whether/how someone becomes re-discoverable
 * after a closed episode is a separate future product decision, not this
 * function's job.
 */
export async function getActiveCorrespondencePartnerIds(
  supabase: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from('correspondences')
    .select('participant_low, participant_high')
    .or(`participant_low.eq.${userId},participant_high.eq.${userId}`)
    .eq('status', 'active')

  const ids = new Set<string>()
  for (const row of data ?? []) {
    ids.add(row.participant_low === userId ? row.participant_high : row.participant_low)
  }
  return ids
}

/**
 * Every Question-answer id the viewer has ever sent a first-contact
 * letter from — permanent, independent of that letter's or its
 * correspondence's current status. Once a specific piece of writing has
 * already been acted on, Explore never resurfaces that exact answer to
 * this viewer again, even if the person later becomes re-discoverable
 * through a different answer.
 */
export async function getContactedAnswerIds(
  supabase: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from(LETTERS_VIEW)
    .select('question_answer_id')
    .eq('sender_id', userId)
    .is('reply_to_id', null)

  const ids = new Set<string>()
  for (const row of data ?? []) {
    if (row.question_answer_id) ids.add(row.question_answer_id)
  }
  return ids
}

/**
 * The status of every correspondence in one batched query — used by the
 * Letters list to categorize correspondence-level rows without an N+1
 * (one query total, not one per row). correspondence.status remains the
 * sole authority here, same as everywhere else it's read.
 */
export async function getCorrespondenceStatuses(
  supabase: SupabaseClient,
  correspondenceIds: string[]
): Promise<Map<string, CorrespondenceStatus>> {
  if (correspondenceIds.length === 0) return new Map()

  const { data } = await supabase
    .from('correspondences')
    .select('id, status')
    .in('id', correspondenceIds)

  return new Map((data ?? []).map((row) => [row.id, row.status as CorrespondenceStatus]))
}

/**
 * photo_consent_status + who requested/resolved it, for many
 * correspondences in one batched query — used by the Letterbox list,
 * together with isPhotoDecisionOutstandingForUser, to show a quiet
 * outstanding-photo indicator to whichever participant actually owes a
 * decision right now (pending non-requester, or deferred resolver).
 * resolvedBy is included specifically so the deferred case can be
 * identified here too — a status-only read can't tell "the requester,
 * still waiting" apart from "the person who deferred, who can still
 * decide."
 */
export async function getCorrespondencePhotoConsent(
  supabase: SupabaseClient,
  correspondenceIds: string[]
): Promise<Map<string, { status: PhotoConsentStatus; requestedBy: string | null; resolvedBy: string | null }>> {
  if (correspondenceIds.length === 0) return new Map()

  const { data } = await supabase
    .from('correspondences')
    .select('id, photo_consent_status, photo_consent_requested_by, photo_consent_resolved_by')
    .in('id', correspondenceIds)

  return new Map(
    (data ?? []).map((row) => [
      row.id,
      {
        status: row.photo_consent_status as PhotoConsentStatus,
        requestedBy: row.photo_consent_requested_by as string | null,
        resolvedBy: row.photo_consent_resolved_by as string | null,
      },
    ])
  )
}

// ============================================================
// MOMENTS — media placed between a letter's paragraphs.
// ============================================================

type MomentRow = {
  id: string
  position: number
  type: MomentType
  image_path: string | null
  postcard_key: string | null
}

// Private storage — every photo URL is short-lived and resolved
// per-request for whoever is actually viewing the letter, never a
// public/stable URL. Long enough to comfortably read one letter and
// view its photos, short enough not to become a durable public link.
const PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 10

/**
 * Every Moment across many letters (a whole correspondence thread) in
 * one batched query, with every Photo's storage path resolved to a
 * short-lived signed URL via one batched `createSignedUrls` call rather
 * than one `createSignedUrl` per photo — reading a thread with several
 * photos never means one storage round trip per photo.
 */
export async function getMomentsForLetters(
  supabase: SupabaseClient,
  letterIds: string[]
): Promise<Map<string, Moment[]>> {
  if (letterIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('moments')
    .select('id, letter_id, position, type, image_path, postcard_key')
    .in('letter_id', letterIds)
    .order('position', { ascending: true })

  if (error) {
    console.error('[moments] read failed', { message: error.message, code: error.code })
  }

  const rows = (data ?? []) as (MomentRow & { letter_id: string })[]

  const photoPaths = [
    ...new Set(
      rows
        .filter((r) => r.type === 'photo' && r.image_path)
        .map((r) => r.image_path as string)
    ),
  ]

  const signedUrlByPath = new Map<string, string>()
  if (photoPaths.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from('letter-photos')
      .createSignedUrls(photoPaths, PHOTO_SIGNED_URL_TTL_SECONDS)

    // Previously swallowed entirely — a signing failure (top-level, or
    // per-path via each result's own `error`) silently left every photo
    // with imageUrl: null, indistinguishable from "not yet consented,"
    // for the sender's own photos included.
    if (signError) {
      console.error('[moments] createSignedUrls failed', { message: signError.message })
    }

    for (const s of signed ?? []) {
      if (s.error) {
        console.error('[moments] signing failed for path', { path: s.path, error: s.error })
      }
      if (s.signedUrl && s.path) signedUrlByPath.set(s.path, s.signedUrl)
    }
  }

  const byLetterId = new Map<string, Moment[]>()
  for (const row of rows) {
    const moment: Moment = {
      id: row.id,
      position: row.position,
      type: row.type,
      imageUrl:
        row.type === 'photo' && row.image_path
          ? signedUrlByPath.get(row.image_path) ?? null
          : null,
      postcardKey: row.postcard_key,
    }
    const arr = byLetterId.get(row.letter_id)
    if (arr) arr.push(moment)
    else byLetterId.set(row.letter_id, [moment])
  }
  return byLetterId
}

// ============================================================
// LETTER-LEVEL POSTCARDS V1 (2026-09-13) — the NEW letterhead-enclosure
// Postcard, durably stored in its own table (public.letter_postcards,
// docs/sql/2026-09-14-letter-level-postcards.sql — APPLIED LIVE AND
// VERIFIED; a real production letter-level Postcard has been sent
// successfully), completely separate from the `moments` table above. A
// historical Moment postcard (type='postcard' in the query above) keeps
// reading and rendering exactly as it always has; this section is
// purely additive alongside it. Widened by docs/sql/2026-09-21-
// postcard-admin-and-keepsakes.sql (Admin Phase 2A-2) to carry every
// presentation field (title/location/collection/postmark/footer text),
// not just artwork — see PostcardBaseContent, lib/moments.ts.
// ============================================================

/** The sending letter's own FROZEN presentation identity — every field
 * a delivered Postcard actually renders, snapshotted once at Send and
 * never touched again regardless of what the catalogue's CURRENT entry
 * later becomes (Admin Phase 2A-2 widened postcard_versions to carry
 * title/location/collection/postmark/footer text alongside the
 * original artwork fields). `revealLineAlignment` is stored as plain
 * text in Postgres (constrained by the table's own CHECK to the same
 * known set PostcardRevealLineAlignment defines) — cast at the point of
 * use rather than re-validated here, since the database already
 * guarantees it. */
export type LetterPostcardVersion = {
  title: string
  location: string
  collection: string
  postmarkText: string
  footerText: string
  frontImagePath: string
  motionSrc: string | null
  durationSeconds: number | null
  revealLineAlignment: string | null
}

export type LetterPostcard = {
  postcardKey: string
  revealLine: string
  backMessage: string
  /** Final pre-migration architecture correction (2026-09-14) — the
   * sender's pseudonym exactly as it was at the moment this Postcard was
   * sent, frozen in `letter_postcards.sender_pseudonym_snapshot`. A sent
   * Postcard is a historical correspondence artifact; unlike the letter
   * header (which intentionally keeps resolving a member's CURRENT
   * pseudonym dynamically, see resolveLetterDirection above), the
   * Postcard's own back signature must never silently rewrite itself
   * just because the sender later renamed themselves. The caller
   * (app/letters/[letterId]/page.tsx) passes this into
   * LetterheadPostcard's `senderPseudonym` prop in preference to any
   * live-resolved name. */
  senderPseudonymSnapshot: string
  /** Thumbnail + expanded-experience checkpoint (2026-09-14) — the
   * exact immutable asset identity that shipped with this letter,
   * resolved through the embedded postcard_versions relation. Passed
   * into LetterheadPostcard's `version` prop so a delivered historical
   * Postcard renders its OWN frozen artwork, never whatever
   * POSTCARD_CATALOG's current entry for the same key happens to define
   * today — closing the gap the previous checkpoint's report disclosed. */
  version: LetterPostcardVersion
}

// `postcard_key` no longer lives directly on letter_postcards — it now
// points at an immutable `postcard_versions` row (see the 2026-09-14
// migration's own versioning model), so the catalog key AND the frozen
// asset fields are both read through that embedded relation.
export type LetterPostcardRow = {
  letter_id: string
  reveal_line: string | null
  back_message: string
  sender_pseudonym_snapshot: string
  postcard_versions: {
    postcard_key: string
    title: string
    location: string
    collection: string
    postmark_text: string
    footer_text: string
    front_image_path: string
    motion_src: string | null
    duration_seconds: number | null
    reveal_line_alignment: string | null
  } | null
}

/**
 * Pure: turns raw (already-fetched) letter_postcards rows — each
 * carrying its embedded postcard_versions relation, per Supabase's own
 * PostgREST embedding for a many-to-one FK — into the Map
 * getLetterPostcardsForLetters returns. Split out specifically so this
 * mapping (reading postcardKey and the frozen asset fields through the
 * version join instead of direct columns, and never fabricating either
 * when the join comes back empty) is directly unit-testable without a
 * live or faked Supabase query-builder chain — this class of function
 * has no live-DB test in this codebase (getMomentsForLetters has none
 * either), but the actual ROW-MAPPING logic doesn't need one to be
 * tested for real.
 */
export function mapLetterPostcardRows(rows: LetterPostcardRow[]): Map<string, LetterPostcard> {
  return new Map(
    rows
      // A row whose version relation failed to embed (should never
      // happen — postcard_version_id is NOT NULL with a real FK — but
      // never trust a join silently) is skipped rather than shown with
      // fabricated asset data.
      .filter(
        (
          row
        ): row is LetterPostcardRow & { postcard_versions: NonNullable<LetterPostcardRow['postcard_versions']> } =>
          row.postcard_versions !== null
      )
      .map((row) => [
        row.letter_id,
        {
          postcardKey: row.postcard_versions.postcard_key,
          revealLine: row.reveal_line ?? '',
          backMessage: row.back_message,
          senderPseudonymSnapshot: row.sender_pseudonym_snapshot,
          version: {
            title: row.postcard_versions.title,
            location: row.postcard_versions.location,
            collection: row.postcard_versions.collection,
            postmarkText: row.postcard_versions.postmark_text,
            footerText: row.postcard_versions.footer_text,
            frontImagePath: row.postcard_versions.front_image_path,
            motionSrc: row.postcard_versions.motion_src,
            durationSeconds: row.postcard_versions.duration_seconds,
            revealLineAlignment: row.postcard_versions.reveal_line_alignment,
          },
        },
      ])
  )
}

/** Converts a delivered letter's own FROZEN version into the generic
 * base content shape lib/moments.ts's resolveLetterPostcardDisplay
 * merges sender overrides onto — used by the delivered reader/Preview's
 * historical rendering. Living Reveal is present only when the frozen
 * version actually carries a motion asset, exactly like a
 * PostcardBaseContent with no `living` at all. */
export function letterPostcardToBaseContent(version: LetterPostcardVersion): PostcardBaseContent {
  return {
    title: version.title,
    location: version.location,
    collection: version.collection,
    frontImagePath: version.frontImagePath,
    postmarkText: version.postmarkText,
    footerText: version.footerText,
    living: version.motionSrc
      ? {
          motionSrc: version.motionSrc,
          durationSeconds: version.durationSeconds ?? undefined,
          revealLineAlignment: (version.revealLineAlignment as PostcardRevealLineAlignment | null) ?? undefined,
        }
      : undefined,
  }
}

/**
 * Every letter-level Postcard across a batch of letters, in one query —
 * mirrors getMomentsForLetters' own batching shape (a Map keyed by
 * letter_id) so a caller reading several letters at once never issues
 * one query per letter. Unlike a Photo Moment, a letter-level Postcard
 * needs no signed URL of its own: its frozen asset paths are plain
 * public paths, resolved through the embedded postcard_versions
 * relation, never Storage.
 */
export async function getLetterPostcardsForLetters(
  supabase: SupabaseClient,
  letterIds: string[]
): Promise<Map<string, LetterPostcard>> {
  if (letterIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('letter_postcards')
    .select(
      'letter_id, reveal_line, back_message, sender_pseudonym_snapshot, postcard_versions(postcard_key, title, location, collection, postmark_text, footer_text, front_image_path, motion_src, duration_seconds, reveal_line_alignment)'
    )
    .in('letter_id', letterIds)

  if (error) {
    console.error('[letter_postcards] read failed', { message: error.message, code: error.code })
  }

  return mapLetterPostcardRows((data ?? []) as unknown as LetterPostcardRow[])
}

// ============================================================
// PER-MEMBER LETTERBOX HIDE STATE — see
// docs/sql/2026-09-01-correspondence-hidden-for-user.sql (prepared, not
// yet applied). Every function here tolerates that table not existing
// yet by treating a query error as "nothing hidden" / "hide not
// recorded" rather than throwing — so the Letterbox and its delete
// action keep working before and after that migration lands.
// ============================================================

/** Every correspondence id THIS member has hidden from their own
 * Letterbox — batched, one query for the whole list rather than one
 * per row. */
export async function getHiddenCorrespondenceIds(
  supabase: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('correspondence_hidden_for_user')
    .select('correspondence_id')
    .eq('user_id', userId)

  if (error || !data) return new Set()
  return new Set(data.map((row) => row.correspondence_id as string))
}

/** Hides one correspondence from the caller's own Letterbox — never
 * affects the other participant's copy or the underlying records.
 * Returns false (rather than throwing) if the write failed, e.g. before
 * the table exists yet, so the caller can show an honest message. */
export async function hideCorrespondenceForViewer(
  supabase: SupabaseClient,
  correspondenceId: string
): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false

  const { error } = await supabase
    .from('correspondence_hidden_for_user')
    .upsert({ user_id: user.id, correspondence_id: correspondenceId }, { onConflict: 'user_id,correspondence_id' })

  return !error
}

// ============================================================
// LETTERBOX PEOPLE — Level 1 of the people-first Letterbox: one card
// per PERSON, never per correspondence episode or individual letter.
// A pair of members may have multiple episodes over time (an old
// closed one, a later new one); this collapses all of a person's
// VISIBLE episodes into one entry, ordered by whichever episode had
// the most recent letter.
// ============================================================

export type LetterboxPerson = {
  userId: string
  pseudonym: string
  country: string
  ageRange: string
  markUrl?: string | null
  /** Epoch ms of the most recent letter across every VISIBLE
   * correspondence episode with this person — the sole sort key for
   * Level 1's grid ("newest person upper-left"). */
  activityAt: number
  /** Count of unread incoming letters (is_unread) across every
   * VISIBLE correspondence episode with this person — summed the same
   * way activityAt is maxed, so a person with two visible episodes
   * shows their combined unread count, not just one episode's. */
  unreadCount: number
  /** The single most recent VISIBLE letter's body across every episode
   * with this person — a row-level preview, same source (letters_for_
   * participant) as everything else here, so it can never show an
   * undelivered incoming letter's content. Null only when somehow no
   * letter body could be resolved (never expected in practice). */
  latestExcerpt: string | null
  /** Whether the viewer has sent at least one VISIBLE letter to this
   * person, in any episode — the "Sent" filter's entire definition. */
  hasSentAny: boolean
  /** Release Polish Pass — whether the single most recent VISIBLE
   * letter with this person (the same one latestExcerpt/activityAt
   * describe) was sent BY the viewer, i.e. "I'm the one waiting on a
   * reply." Derived from data the existing query already fetches
   * (sender_id) — no new query. Powers deriveLetterboxCardStatus's
   * "Waiting for a reply" state; false whenever the sender is unknown
   * or was actually the other person. */
  lastLetterFromViewer: boolean
}

/**
 * Pure: collapses raw correspondence rows + this viewer's hidden set +
 * each correspondence's latest-letter data and unread count into one
 * entry per other participant. A correspondence the viewer has hidden
 * is excluded before the per-person collapse — a person with one
 * hidden and one visible episode still appears (driven by the visible
 * one's activity/unread/excerpt), and a person with every episode
 * hidden never appears at all.
 */
export function buildLetterboxPeople(
  userId: string,
  correspondences: { id: string; participant_low: string; participant_high: string }[],
  hiddenCorrespondenceIds: Set<string>,
  latestLetterByCorrespondence: Map<string, { createdAt: string; body: string; senderId?: string }>,
  unreadCountByCorrespondence: Map<string, number>,
  sentCorrespondenceIds: Set<string>,
  profilesById: Map<string, { pseudonym: string; country: string; age_range: string; mark_id?: string | null }>,
  markUrlForId: (markId: string) => string = () => ''
): LetterboxPerson[] {
  const activityByPerson = new Map<string, number>()
  const excerptByPerson = new Map<string, string>()
  const lastSenderByPerson = new Map<string, string | undefined>()
  const unreadByPerson = new Map<string, number>()
  const sentByPerson = new Map<string, boolean>()

  for (const c of correspondences) {
    if (hiddenCorrespondenceIds.has(c.id)) continue
    const otherId = c.participant_low === userId ? c.participant_high : c.participant_low

    const latest = latestLetterByCorrespondence.get(c.id)
    if (latest) {
      const activityAt = new Date(latest.createdAt).getTime()
      const existing = activityByPerson.get(otherId)
      if (existing === undefined || activityAt > existing) {
        activityByPerson.set(otherId, activityAt)
        excerptByPerson.set(otherId, latest.body)
        lastSenderByPerson.set(otherId, latest.senderId)
      }
    }

    const unread = unreadCountByCorrespondence.get(c.id) ?? 0
    unreadByPerson.set(otherId, (unreadByPerson.get(otherId) ?? 0) + unread)

    if (sentCorrespondenceIds.has(c.id)) {
      sentByPerson.set(otherId, true)
    }
  }

  const people: LetterboxPerson[] = []
  for (const [otherId, activityAt] of activityByPerson) {
    const profile = profilesById.get(otherId)
    if (!profile) continue
    people.push({
      userId: otherId,
      pseudonym: profile.pseudonym,
      country: profile.country,
      ageRange: profile.age_range,
      markUrl: profile.mark_id ? markUrlForId(profile.mark_id) : null,
      activityAt,
      unreadCount: unreadByPerson.get(otherId) ?? 0,
      latestExcerpt: excerptByPerson.get(otherId) ?? null,
      hasSentAny: sentByPerson.get(otherId) ?? false,
      lastLetterFromViewer: lastSenderByPerson.get(otherId) === userId,
    })
  }

  return people.sort((a, b) => b.activityAt - a.activityAt)
}

export type LetterboxCardStatus =
  | { kind: 'new'; count: number }
  | { kind: 'waiting_for_reply' }
  | { kind: 'last_exchanged'; activityAt: number }

/**
 * Release Polish Pass — Letterbox's own responsive correspondence-card
 * grid needs one quiet status line per card, derived entirely from
 * data the card already has (never a new query): an unread incoming
 * letter takes priority ("New letter" — the corner UnreadBadge already
 * carries the count separately), then "the viewer's own last letter
 * here hasn't been replied to yet," and finally a plain "last
 * exchanged" date as the quiet default.
 *
 * Deliberately does NOT fold "mail in transit" into this same status —
 * a letter already delivered-and-unread and a SEPARATE letter still
 * travelling toward the viewer are two independent, simultaneously-
 * true facts (not a single mutually-exclusive state), so the caller
 * renders "Mail on the way" as its own always-independent line
 * whenever mailInTransitPersonIds says so, exactly as it always has,
 * alongside whatever this function returns.
 */
export function deriveLetterboxCardStatus(person: LetterboxPerson): LetterboxCardStatus {
  if (person.unreadCount > 0) return { kind: 'new', count: person.unreadCount }
  if (person.lastLetterFromViewer) return { kind: 'waiting_for_reply' }
  return { kind: 'last_exchanged', activityAt: person.activityAt }
}

export type LetterboxFilter = 'all' | 'new' | 'sent'

/**
 * Pure: Letterbox Level 1's All / New / Sent filter — operates entirely
 * on the already-fetched, already viewer-scoped people list (no extra
 * query per filter). "New" = at least one visible unread incoming
 * letter (never counts an undelivered one — unreadCount itself is
 * already sourced from letters_for_participant's own is_unread, which
 * can never be true for an undelivered row). "Sent" = the viewer has
 * sent at least one visible letter to that person, in any episode.
 */
export function filterLetterboxPeople(people: LetterboxPerson[], filter: LetterboxFilter): LetterboxPerson[] {
  if (filter === 'new') return people.filter((p) => p.unreadCount > 0)
  if (filter === 'sent') return people.filter((p) => p.hasSentAny)
  return people
}

/**
 * Every person the viewer has at least one VISIBLE correspondence
 * episode with, newest-activity first, with each person's aggregate
 * unread incoming-letter count. Deliberately avoids fetching full
 * letter bodies or hidden-correspondence letters — only
 * (correspondence_id, created_at, recipient_id, is_unread) is read per
 * letter, restricted to already-visible correspondence ids, in one
 * pass; never the member's entire letter history the way getMyLetters
 * does.
 */
export async function getLetterboxPeople(
  supabase: SupabaseClient,
  userId: string
): Promise<LetterboxPerson[]> {
  const [{ data: correspondences }, hiddenCorrespondenceIds] = await Promise.all([
    supabase
      .from('correspondences')
      .select('id, participant_low, participant_high')
      .or(`participant_low.eq.${userId},participant_high.eq.${userId}`),
    getHiddenCorrespondenceIds(supabase, userId),
  ])

  const rows = correspondences ?? []
  const visibleIds = rows.filter((c) => !hiddenCorrespondenceIds.has(c.id)).map((c) => c.id)
  if (visibleIds.length === 0) return []

  const { data: letterRows } = await supabase
    .from(LETTERS_VIEW)
    .select('correspondence_id, created_at, sender_id, recipient_id, is_unread, body')
    .in('correspondence_id', visibleIds)
    .order('created_at', { ascending: false })

  const latestLetterByCorrespondence = new Map<string, { createdAt: string; body: string; senderId?: string }>()
  const unreadCountByCorrespondence = new Map<string, number>()
  const sentCorrespondenceIds = new Set<string>()
  for (const row of letterRows ?? []) {
    // Rows arrive newest-first (order by created_at desc above), so the
    // first row seen per correspondence is already its latest.
    if (!latestLetterByCorrespondence.has(row.correspondence_id)) {
      latestLetterByCorrespondence.set(row.correspondence_id, {
        createdAt: row.created_at,
        body: row.body,
        senderId: row.sender_id,
      })
    }
    if (row.recipient_id === userId && row.is_unread) {
      unreadCountByCorrespondence.set(
        row.correspondence_id,
        (unreadCountByCorrespondence.get(row.correspondence_id) ?? 0) + 1
      )
    }
    if (row.sender_id === userId) {
      sentCorrespondenceIds.add(row.correspondence_id)
    }
  }

  const visibleIdSet = new Set(visibleIds)
  const otherIds = [
    ...new Set(
      rows
        .filter((c) => visibleIdSet.has(c.id))
        .map((c) => (c.participant_low === userId ? c.participant_high : c.participant_low))
    ),
  ]
  if (otherIds.length === 0) return []

  const { data: profiles } = await supabase
    .from('public_profiles')
    .select('id, pseudonym, country, age_range, mark_id')
    .in('id', otherIds)

  const profilesById = new Map((profiles ?? []).map((p) => [p.id, p]))

  return buildLetterboxPeople(
    userId,
    rows,
    hiddenCorrespondenceIds,
    latestLetterByCorrespondence,
    unreadCountByCorrespondence,
    sentCorrespondenceIds,
    profilesById,
    (markId) => publicProfileMarkUrl(supabase, `${markId}.png`)
  )
}

// ============================================================
// LETTER ARCHIVE WITH ONE PERSON — Level 2: every letter across every
// VISIBLE correspondence episode shared with one specific person,
// newest first. Distinct from getLettersForCorrespondence (a single
// episode, oldest first, for the existing thread reader) — a pair may
// have more than one episode over time, and this deliberately spans
// all of them.
// ============================================================

export type ArchiveLetter = Letter & {
  momentCounts: MomentCounts
  /** Whether this letter carries a letter-level Postcard (letter_postcards
   * — Letter-Level Postcards V1, 2026-09-14) — deliberately NOT the same
   * thing as momentCounts.postcard, which counts the OLD inline
   * moments.type='postcard' rows from before that migration. Drives the
   * Letterbox Postcard indicator (archive-list.tsx); see
   * attachLetterPostcardFlags's own doc comment for why these two are
   * never conflated. */
  hasLetterPostcard: boolean
}

/** Pure: which of a pair's correspondence ids are visible to the
 * viewer — every episode with this person, minus whichever the viewer
 * has hidden. */
export function visibleCorrespondenceIdsForPair(
  correspondences: { id: string }[],
  hiddenCorrespondenceIds: Set<string>
): string[] {
  return correspondences.map((c) => c.id).filter((id) => !hiddenCorrespondenceIds.has(id))
}

/** Pure: pairs each letter with its Moment counts, defaulting to zero
 * — the one thing an archive card's photo icon depends on. */
export function attachMomentCounts(
  letters: Letter[],
  momentCounts: Map<string, MomentCounts>
): (Letter & { momentCounts: MomentCounts })[] {
  return letters.map((letter) => ({
    ...letter,
    momentCounts: momentCounts.get(letter.id) ?? { photo: 0, postcard: 0 },
  }))
}

/**
 * Pure: layers the letter-level-Postcard presence flag on top of
 * attachMomentCounts' own output. Kept as a SEPARATE pass (not folded
 * into attachMomentCounts itself) specifically so the two data sources
 * stay visibly distinct at the call site — letterPostcardLetterIds must
 * come from getLetterPostcardsForLetters (the new letter_postcards
 * table), never from the `moments` table's historical type='postcard'
 * rows attachMomentCounts already reads, which is a different, older
 * feature (inline Postcard Moments, retired for new composition — see
 * moments-composer.tsx's own doc comment) and must never be shown as if
 * it were a new letter-level Postcard.
 */
export function attachLetterPostcardFlags(
  letters: (Letter & { momentCounts: MomentCounts })[],
  letterPostcardLetterIds: Set<string>
): ArchiveLetter[] {
  return letters.map((letter) => ({
    ...letter,
    hasLetterPostcard: letterPostcardLetterIds.has(letter.id),
  }))
}

/**
 * Every letter the viewer and otherUserId have exchanged across every
 * VISIBLE correspondence episode between them, newest first — the
 * data behind Level 2's per-letter archive cards. A pair's
 * participant_low/participant_high is always the same regardless of
 * who initiated any given episode, so every episode between this
 * exact pair is one direct lookup, never an OR across two directions.
 */
/**
 * Every VISIBLE correspondence episode id shared with one specific
 * person — what "Remove from my Letterbox" needs from the archive
 * header (app/letters/with/[userId]/page.tsx) to hide the whole
 * person, not just whichever single episode a specific letter happens
 * to belong to (see RemoveFromLetterbox, app/letters/remove-from-
 * letterbox.tsx). A pair can have more than one episode over time (an
 * old closed one, a later new one) — this returns all of the visible
 * ones, same participant_low/high lookup getLetterArchiveWithUser
 * already does.
 */
export async function getVisibleCorrespondenceIdsWithUser(
  supabase: SupabaseClient,
  userId: string,
  otherUserId: string
): Promise<string[]> {
  const participantLow = userId < otherUserId ? userId : otherUserId
  const participantHigh = userId < otherUserId ? otherUserId : userId

  const [{ data: correspondences }, hiddenCorrespondenceIds] = await Promise.all([
    supabase
      .from('correspondences')
      .select('id')
      .eq('participant_low', participantLow)
      .eq('participant_high', participantHigh),
    getHiddenCorrespondenceIds(supabase, userId),
  ])

  return visibleCorrespondenceIdsForPair(correspondences ?? [], hiddenCorrespondenceIds)
}

export async function getLetterArchiveWithUser(
  supabase: SupabaseClient,
  userId: string,
  otherUserId: string
): Promise<ArchiveLetter[]> {
  const participantLow = userId < otherUserId ? userId : otherUserId
  const participantHigh = userId < otherUserId ? otherUserId : userId

  const [{ data: correspondences }, hiddenCorrespondenceIds] = await Promise.all([
    supabase
      .from('correspondences')
      .select('id')
      .eq('participant_low', participantLow)
      .eq('participant_high', participantHigh),
    getHiddenCorrespondenceIds(supabase, userId),
  ])

  const visibleIds = visibleCorrespondenceIdsForPair(correspondences ?? [], hiddenCorrespondenceIds)
  if (visibleIds.length === 0) return []

  const { data } = await supabase
    .from(LETTERS_VIEW)
    .select(LETTER_COLUMNS)
    .in('correspondence_id', visibleIds)
    .order('created_at', { ascending: false })

  const letters = (data ?? []).map((row) => toLetter(row as LetterRow))
  const letterIds = letters.map((l) => l.id)
  const [momentCounts, letterPostcards] = await Promise.all([
    getMomentCountsForLetters(supabase, letterIds),
    // Letterbox Postcard indicator (pre-beta UX polish batch 1) — the
    // NEW letter-level Postcard table, deliberately a separate query
    // from getMomentCountsForLetters above (which reads the OLD
    // moments.type='postcard' rows) — see attachLetterPostcardFlags's
    // own doc comment for why these must never be conflated.
    getLetterPostcardsForLetters(supabase, letterIds),
  ])

  return attachLetterPostcardFlags(attachMomentCounts(letters, momentCounts), new Set(letterPostcards.keys()))
}

export type MomentCounts = { photo: number; postcard: number }

/**
 * Moment presence for many letters in one batched query — for a list
 * row's compact "contains Moments" indicator, which only needs to know
 * type + count, never the actual image. Deliberately does NOT resolve
 * any signed URL (unlike getMomentsForLetter): doing that per row in a
 * list would mean a storage round trip per photo per row, an N+1 this
 * function exists specifically to avoid.
 */
export async function getMomentCountsForLetters(
  supabase: SupabaseClient,
  letterIds: string[]
): Promise<Map<string, MomentCounts>> {
  if (letterIds.length === 0) return new Map()

  const { data } = await supabase
    .from('moments')
    .select('letter_id, type')
    .in('letter_id', letterIds)

  const counts = new Map<string, MomentCounts>()
  for (const row of data ?? []) {
    const current = counts.get(row.letter_id) ?? { photo: 0, postcard: 0 }
    if (row.type === 'photo') current.photo += 1
    else if (row.type === 'postcard') current.postcard += 1
    counts.set(row.letter_id, current)
  }
  return counts
}
