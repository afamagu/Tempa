export type MomentType = 'photo' | 'postcard'

export type Moment = {
  id: string
  position: number
  type: MomentType
  /** Photo only — a short-lived signed URL, resolved server-side per request. Never a public URL. */
  imageUrl: string | null
  /** Postcard only. */
  postcardKey: string | null
}

// A Moment drafted in the composer, before the letter (and therefore
// the Moment row itself) exists. Photo drafts carry the storage path
// already uploaded to — image bytes are never held across the RPC call.
export type MomentDraft =
  | { position: number; type: 'photo'; imagePath: string }
  | { position: number; type: 'postcard'; postcardKey: string }

/**
 * The exact JSON shape reply_to_letter actually reads off each
 * p_moments element (`elem->>'image_path'`, `elem->>'postcard_key'` —
 * see docs/sql/2026-09-02-reply-to-letter-moments-alias-fix.sql). This
 * is a separate, snake_case, RPC-boundary type — MomentDraft stays
 * camelCase (this project's ordinary TypeScript convention) everywhere
 * else; only toMomentRpcPayload below crosses that boundary.
 */
export type MomentRpcPayload = {
  position: number
  type: MomentType
  image_path: string | null
  postcard_key: string | null
}

/**
 * Serializes one MomentDraft into the RPC's actual wire contract,
 * immediately before it's sent. The previously-live bug: MomentDraft's
 * camelCase `imagePath`/`postcardKey` were passed straight through as
 * `p_moments`, so `elem->>'image_path'` / `elem->>'postcard_key'` found
 * no matching key and read NULL for every Moment — violating
 * moments_type_fields_consistent's NOT NULL side for whichever field
 * actually applied. The opposite field is always sent as an explicit
 * `null` (never simply omitted) so the wire contract states both halves
 * unambiguously, matching what the CHECK constraint itself demands:
 * exactly one of image_path/postcard_key set, never "key absent."
 */
export function toMomentRpcPayload(draft: MomentDraft): MomentRpcPayload {
  return draft.type === 'photo'
    ? { position: draft.position, type: 'photo', image_path: draft.imagePath, postcard_key: null }
    : { position: draft.position, type: 'postcard', image_path: null, postcard_key: draft.postcardKey }
}

// TEMPA Living Postcards V1, Checkpoint 1 (2026-09-08) — where a future
// per-template Reveal Line can sit without every postcard needing the
// exact same placement. A small, closed, extensible set rather than
// arbitrary CSS, so a future template catalog stays type-safe.
export type PostcardRevealLineAlignment =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

/**
 * Optional Living Reveal media for a Postcard — entirely additive.
 * A PostcardData with no `living` behaves exactly like today's static
 * Postcard (this is how every historical/catalog Postcard, including
 * POSTCARD_CATALOG.essaouira, continues to work unmodified). Deliberately
 * NOT coupled to Supabase/the moments table here — this checkpoint is
 * the reusable visual engine only; a future checkpoint decides how (and
 * whether) this gets persisted per letter-level Postcard.
 */
export type PostcardLivingReveal = {
  /** The motion asset. Muted, playsInline, no loop, no native controls —
   * see app/letters/postcard-object.tsx's own rules. */
  motionSrc: string
  /** The resting still shown before playback and returned to afterward.
   * Defaults to the postcard's own frontImagePath when omitted. */
  posterSrc?: string
  /** Optional short sender-written line shown during roughly the latter
   * half of playback. Product rule: at most 32 characters, ideally 3-7
   * words — always passed through clampRevealLine before rendering, so
   * a too-long value can never overflow the card regardless of what a
   * future caller supplies. */
  revealLine?: string
  /** Where the Reveal Line sits on the card. Defaults to 'bottom-center'
   * when a revealLine is given but no alignment is specified. */
  revealLineAlignment?: PostcardRevealLineAlignment
  /** Informational only — the asset's intended length (normally 7-8s,
   * up to 10s for future assets). Used only to schedule the Reveal
   * Line's fade-in/out when the video's own real duration isn't known
   * yet; never used to cut playback short — the video's own `ended`
   * event is what actually returns the card to its resting state. */
  durationSeconds?: number
}

export const REVEAL_LINE_MAX_LENGTH = 32

/**
 * Defensive, client-side clamp to the Reveal Line product rule (at most
 * 32 characters). This is not a substitute for whatever a future
 * composer/server-side validation does — it exists so the rendering
 * engine itself can never be made to overflow a card just because some
 * future caller supplied a too-long string.
 */
export function clampRevealLine(line: string): string {
  const trimmed = line.trim()
  return trimmed.length <= REVEAL_LINE_MAX_LENGTH ? trimmed : trimmed.slice(0, REVEAL_LINE_MAX_LENGTH).trim()
}

// Front/back metadata for one Tempa postcard — the shape a future
// first-class Postcard catalog can grow into without a redesign. The
// visual component (app/letters/postcard-object.tsx, used by
// app/letters/moment-display.tsx for historical Moment postcards) never
// hard-codes any of this; it only renders whatever PostcardData it's
// given, so the same flip interaction works identically for the
// tutorial's Essaouira card and any future catalog entry.
export type PostcardData = {
  title: string
  location: string
  collection: string
  frontImagePath: string
  /** The back's message-side text. May contain blank-line-separated
   * paragraphs, same convention as a letter body. */
  backMessage: string
  senderName?: string
  recipientLabel?: string
  recipientDetail?: string
  /** The stamp/postmark area's text — may contain a line break. Kept
   * distinct from title/location since a real postmark won't always
   * literally repeat them. */
  postmarkText: string
  date?: string
  footerText?: string
  /** Absent for every historical/catalog Postcard today — see
   * PostcardLivingReveal's own doc comment. */
  living?: PostcardLivingReveal
}

// Admin Phase 2A-2 — LEGACY ONLY. This static catalog is no longer the
// authoritative source for NEW letter-level Postcard sending; that role
// now belongs entirely to the DB-backed catalogue (lib/postcards.ts's
// getActivePostcards, reading public.postcard_catalog/postcard_versions
// live). POSTCARD_CATALOG remains exclusively for resolving a
// HISTORICAL inline `moments.type = 'postcard'` row
// (postcard-moment-node.tsx/MomentDisplay) — a separate, untouched
// legacy feature that predates letter-level Postcards and was never
// migrated to the DB catalogue (it has no versioning/freezing need of
// its own: a historical Moment postcard has always resolved its
// artwork from this exact object, unchanged, for as long as it's
// existed). Do not add a NEW Postcard here to make it available for
// letter-level sending — that only ever happens through Admin
// (lib/admin-postcards.ts), never a code change.
export const POSTCARD_CATALOG: Record<string, PostcardData> = {
  essaouira: {
    title: 'Essaouira',
    location: 'Atlantic Morocco',
    collection: 'Atlantic Morocco Collection',
    frontImagePath: '/postcards/essaouira.jpg',
    backMessage:
      'I took the long way to get bread this morning.\n\nNothing remarkable happened here today.\n\nI thought you might like to see it.',
    senderName: 'Youssef',
    recipientLabel: 'Evening Quill',
    recipientDetail: 'Somewhere far from the Atlantic',
    postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
    footerText: 'Tempa Postcard · Atlantic Morocco Collection',
    // Living Postcards V1, Checkpoint 2 — the canonical, real (not test-
    // fixture) motion asset. posterSrc is deliberately omitted: the
    // existing frontImagePath above is already the correct resting/
    // poster state, and PostcardObject falls back to it automatically.
    // No revealLine yet — a hard-coded fake sender line does not belong
    // in production catalog data; the real one arrives with the future
    // sent-letter Postcard architecture. durationSeconds is the asset's
    // actual measured length (~10.04s via its own moov/mvhd atom) —
    // informational scheduling metadata only, never a playback cutoff;
    // the real `ended` event is what ends the reveal.
    living: {
      motionSrc: '/postcards/essaouira-living.mp4',
      durationSeconds: 10.04,
    },
  },

  // Second canonical Living Postcard — proves the same reusable engine
  // (PostcardObject/PostcardBack/flip/reduced-motion/Replay/hourglass)
  // supports more than one card without any special-casing. Deliberately
  // NOT a real sender identity: `senderName`/`recipientLabel`/
  // `recipientDetail` are all omitted (all optional on PostcardData —
  // PostcardBack's own conditional rendering already handles their
  // absence cleanly, same as it would for any future catalog entry that
  // doesn't set them) rather than inventing a fake real person. This is
  // the minimum tasteful catalog-authored back needed for the CURRENT
  // prototype to render/flip correctly — temporary, and expected to be
  // replaced entirely once the letter-level Postcard architecture
  // carries real sender-written content.
  bangkokAfterRain: {
    title: 'Bangkok',
    location: 'Thailand after rain',
    collection: 'Thailand After Rain Collection',
    frontImagePath: '/postcards/bangkok-after-rain.jpg',
    backMessage: 'A quiet moment after the rain, somewhere in Bangkok.',
    postmarkText: 'BANGKOK\nTHAILAND',
    footerText: 'Tempa Postcard · Thailand After Rain Collection',
    // No revealLine, same reasoning as Essaouira above. durationSeconds
    // independently verified against the real asset's own moov/mvhd
    // atom (~10.042s measured) — matches the specified value.
    living: {
      motionSrc: '/postcards/bangkok-after-rain-living.mp4',
      durationSeconds: 10.04,
    },
  },
}

export const DEFAULT_POSTCARD_KEY = 'essaouira'

// ============================================================
// LETTER-LEVEL POSTCARDS V1 (2026-09-13) — the product decision
// deliberately deferred until Living Postcards, Preview, and a real Send
// were all live-tested: NEW POSTCARDS ARE NOT MOMENTS. A Postcard is one
// optional designed enclosure belonging to the entire letter (never a
// paragraph-positioned node), while a Moment stays a photograph
// belonging to a specific paragraph. Historical `moments.type =
// 'postcard'` rows, and the still-registered `postcardMoment` ProseMirror
// node (postcard-moment-node.tsx), are UNTOUCHED and remain fully
// readable/restorable forever — this section only concerns the NEW
// letter-level shape, additive alongside that legacy support.
// ============================================================

/** A letter carries at most one Postcard, described by exactly these
 * three sender-controlled fields — everything else (front image,
 * catalog metadata, Living Reveal asset) comes from POSTCARD_CATALOG via
 * `postcardKey`, never duplicated here. Used identically by the
 * composer's own draft state (lib/letter-editor-draft.ts) and by the
 * durable `letter_postcards` row once actually sent — the two shapes are
 * deliberately kept structurally identical (camelCase here, snake_case
 * at the RPC/DB boundary only) so a draft and a delivered Postcard are
 * never two different concepts wearing the same name. */
export type LetterPostcardDraft = {
  postcardKey: string
  /** At most REVEAL_LINE_MAX_LENGTH characters. Blank means no Reveal
   * Line at all (PostcardObject already treats an empty/undefined
   * revealLine as "no line," never an empty rendered label). */
  revealLine: string
  /** At most POSTCARD_BACK_MESSAGE_MAX_LENGTH characters. Blank while
   * drafting is explicitly allowed — see resolveLetterPostcardDisplay's
   * own fallback for what renders in that case. */
  backMessage: string
}

// Smoke-test contract completion checkpoint — 200 -> 300, mirroring
// write_letter/reply_to_letter (Letter Postcards) and publish_dispatch
// (Dispatch Postcards) server-side checks exactly, and the
// letter_postcards_back_message_length / dispatch_postcards_back_
// message_length CHECK constraints (docs/sql/2026-09-28-title-postcard-
// and-edit-window.sql). One shared constant reused by both the Dispatch
// and Letter Postcard composers (both mount the same PostcardEditor/
// PostcardObject) — the front-side Reveal Line limit
// (REVEAL_LINE_MAX_LENGTH) is untouched by this checkpoint.
export const POSTCARD_BACK_MESSAGE_MAX_LENGTH = 300

/**
 * Postcard back copy + recipient cleanup (2026-09-14); placeholder
 * semantics correction (2026-09-14) — the ONE shared UI placeholder for
 * a letter-level Postcard's back while it is genuinely blank. Used in
 * exactly ONE place: the editable textarea's own `placeholder` attribute
 * (postcard-object.tsx) — never injected into its `value`, and never
 * returned by resolveLetterPostcardDisplay as backMessage data. UI
 * GUIDANCE ONLY, shown only to the sender while they are actually typing
 * — it must never become backMessage data, resolved display data,
 * Preview content, delivered content, persisted draft content, or RPC
 * payload content. A blank sender backMessage resolves to a genuinely
 * empty string everywhere else (see resolveLetterPostcardDisplay below),
 * so a read-only render (Preview, a still-blank draft) simply shows no
 * message at all rather than this or any other text standing in for one.
 * Send itself is blocked elsewhere (moments-composer.tsx's own
 * blank-back guard, mirrored server-side) until the sender writes
 * something real.
 */
export const POSTCARD_BACK_PLACEHOLDER = 'Write something for them…'

/**
 * Admin Phase 2A-2 — the closed set of presentation fields a NEW
 * letter-level Postcard actually renders, independent of WHERE they
 * came from: either the live DB catalogue's current entry
 * (lib/postcards.ts's postcardEntryToBaseContent — composer/Preview's
 * own draft-preview usage, nothing sent/frozen yet) or a delivered
 * letter's own FROZEN postcard_versions row
 * (lib/letters.ts's letterPostcardToBaseContent — the exact version
 * that shipped with that letter, forever). resolveLetterPostcardDisplay
 * below no longer looks anything up itself — the caller always
 * resolves this first, so the function has no notion of "unknown key"
 * at all; that question is answered upstream, once, by whichever
 * lookup actually has a real catalogue/version row to offer.
 */
export type PostcardBaseContent = {
  title: string
  location: string
  collection: string
  frontImagePath: string
  postmarkText: string
  footerText: string
  living?: PostcardLivingReveal
}

/**
 * The ONE place a letter-level Postcard's sender-provided fields are
 * merged onto its resolved base content for DISPLAY — used identically
 * by the composer's own live editor preview (postcard-editor.tsx) and
 * the read-only letterhead slot shared by Preview and the delivered
 * reader (app/letters/letterhead-postcard.tsx), so a Postcard never
 * looks different depending on which surface is showing it or where
 * its base content came from. Never mutates its `base` argument.
 *
 * A blank sender backMessage never inherits any canned demo prose —
 * that was a real, confirmed bug in an earlier version of this
 * function (when `base` still came from the legacy static catalog,
 * whose entries carried tutorial/demo prose): Preview's own read-only
 * "open the Postcard" experience on a still-blank draft used to
 * display it as though the sender had already written something.
 * Blank now resolves to a genuinely empty string instead.
 * POSTCARD_BACK_PLACEHOLDER is UI guidance only (the editable
 * textarea's own `placeholder` attribute, in postcard-object.tsx) — it
 * is never returned here as backMessage data. A SENT letter-level
 * Postcard is server-validated to always carry a real, non-blank
 * back_message, so an empty backMessage here is never actually reached
 * for a genuinely delivered Postcard — only for a still-blank draft.
 *
 * `recipientLabel`/`recipientDetail` are ALWAYS suppressed here: V1
 * supports no real recipient-identity display on this back at all —
 * never replaced with the real recipient pseudonym, an invented
 * address, or any other detail either; that region simply goes
 * visually unused for a letter-level Postcard. This function is ONLY
 * ever used for the NEW letter-level architecture — a historical
 * `moments.type = 'postcard'` row is resolved directly from
 * POSTCARD_CATALOG by postcard-moment-node.tsx/MomentDisplay, a
 * completely separate path this function never touches.
 *
 * Pre-migration audit correction (2026-09-14) — `senderPseudonym` is a
 * SEPARATE override, deliberately NOT snapshotted anywhere: a letter-
 * level Postcard's "— <name>" line must show the REAL sending member's
 * CURRENT pseudonym, resolved exactly like every other sender-name
 * display already in this reader (resolveLetterDirection,
 * lib/letters.ts, itself dynamic). Omitted entirely only for a caller
 * that genuinely has no real sender yet — this should never happen for
 * a real letter-level Postcard in production.
 */
export function resolveLetterPostcardDisplay(
  base: PostcardBaseContent,
  overrides: {
    revealLine: string
    backMessage: string
    senderPseudonym?: string
  }
): PostcardData {
  const revealLine = overrides.revealLine.trim().length > 0 ? overrides.revealLine : undefined

  const living = base.living ? { ...base.living, revealLine } : undefined

  return {
    title: base.title,
    location: base.location,
    collection: base.collection,
    frontImagePath: base.frontImagePath,
    postmarkText: base.postmarkText,
    footerText: base.footerText,
    senderName: overrides.senderPseudonym,
    backMessage: overrides.backMessage.trim().length > 0 ? overrides.backMessage : '',
    // Never a real recipient identity for a letter-level Postcard — see
    // this function's own doc comment above.
    recipientLabel: undefined,
    recipientDetail: undefined,
    living,
  }
}

// Letters remain a single text blob (unchanged from before Moments) —
// paragraphs are simply blank-line-separated regions of that same body,
// mirrored exactly against the `\n\s*\n` split the database uses when
// validating a Moment's position (see reply_to_letter in
// docs/sql/2026-08-31-moments.sql). Keeping this logic here, shared by
// the composer and the reader, is what keeps the two in agreement.
export function splitParagraphs(body: string): string[] {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
}

/**
 * Every paragraph the writer has actually finished — i.e. followed by a
 * blank line — in the continuous composer (moments-composer.tsx). The
 * paragraph still being typed is never "finished," so it never gets a
 * quiet photo-Moment affordance: pressing Enter to start a new paragraph
 * is what makes the PREVIOUS one eligible, not the act of typing itself.
 * Their array index is exactly the `position` a Moment attached to that
 * paragraph is sent with — unchanged from the RPC/database contract.
 */
export function completedParagraphs(body: string): string[] {
  const paragraphs = splitParagraphs(body)
  return paragraphs.length > 1 ? paragraphs.slice(0, -1) : []
}

export function joinParagraphs(paragraphs: string[]): string {
  return paragraphs.map((p) => p.trim()).join('\n\n')
}
