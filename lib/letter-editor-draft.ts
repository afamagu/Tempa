// The continuous editor's own draft persistence — deliberately a
// SEPARATE module and localStorage key namespace from lib/letter-
// draft.ts, which stores a plain string and remains exactly as-is for
// the first-contact-reply's own plain-string-draft path (which layers
// bold/italic markup on top of that same plain string rather than
// switching formats — see lib/letter-editor-doc.ts's
// markupBodyToLetterDoc). Keeping them apart means this file's richer
// JSON format can never corrupt or be misread by that simpler,
// unrelated draft, and vice versa.
//
// Unlike a plain-text-only draft, this stores the full document shape
// — paragraphs, text with its bold/italic marks, and which paragraph
// an unsent photo Moment belongs to — so refreshing mid-letter no
// longer silently drops formatting or an attached-but-unsent photo's
// placement. It still cannot restore a *preview image* by itself:
// `previewUrl` is a `URL.createObjectURL` reference that dies with the
// page, so only `imagePath` (the file's real, already-uploaded
// Supabase Storage path) is persisted; the composer re-requests a
// fresh signed URL for it on restore (see moments-composer.tsx) rather
// than trying to persist a preview that can't survive a reload.
//
// Three scopes share this same storage shape and read/write/clear
// logic, distinguished only by their localStorage key prefix — never
// by a different serialization format, per the writing-essentials
// audit's "do not create an incompatible second draft format"
// requirement:
//   - correspondence-scoped: the Write Anytime composer, keyed by the
//     real correspondenceId that already exists once a correspondence
//     is established.
//   - first-contact-scoped: the very first letter to someone, BEFORE
//     any correspondence exists to key a draft on — keyed by
//     recipientId instead, so a draft begun for one recipient can
//     never appear in a different recipient's composer (different key
//     entirely, not merely different content under a shared key).
//   - Dispatch-scoped: a Dispatch before it's published, keyed by the
//     author's own id (see docs/sql/2026-09-07-dispatches-and-board.sql
//     — there is no server-side draft row for this surface at all).
//     Carries a richer shape than the other three scopes (title + doc +
//     topics, not just doc) — see readDispatchDraft/writeDispatchDraft
//     below, which reuse the same JSON-blob storage mechanics with
//     their own emptiness rule rather than forcing the wrapped shape
//     through readDraft/writeDraft's LetterDocJSON-only contract.

import { letterDocHasContent, stripTransientPhotoPreviews, type LetterDocJSON } from './letter-editor-doc'
import type { LetterPostcardDraft } from './moments'

// Draft-integrity checkpoint (2026-09-08) — see
// stripTransientPhotoPreviews's own doc comment (letter-editor-doc.ts)
// for the full root-cause explanation. Applied on BOTH sides of this
// module's one storage boundary: on write, so a browser-session-only
// blob: URL is never durably persisted going forward; on read, so a
// draft saved before this fix (which still has the stale value sitting
// in localStorage) self-heals the moment it's loaded, rather than
// staying permanently broken until the member happens to edit it again.
function readDraft(key: string): LetterDocJSON | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return stripTransientPhotoPreviews(JSON.parse(raw) as LetterDocJSON)
  } catch {
    return null
  }
}

function writeDraft(key: string, doc: LetterDocJSON): void {
  try {
    if (letterDocHasContent(doc)) {
      window.localStorage.setItem(key, JSON.stringify(stripTransientPhotoPreviews(doc)))
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    // ignore storage failures (e.g. private browsing quota)
  }
}

function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

function correspondenceDraftKey(correspondenceId: string): string {
  return `tempa-letter-editor-draft:${correspondenceId}`
}

export function readLetterEditorDraft(correspondenceId: string): LetterDocJSON | null {
  return readDraft(correspondenceDraftKey(correspondenceId))
}

export function writeLetterEditorDraft(correspondenceId: string, doc: LetterDocJSON): void {
  writeDraft(correspondenceDraftKey(correspondenceId), doc)
}

export function clearLetterEditorDraft(correspondenceId: string): void {
  clearDraft(correspondenceDraftKey(correspondenceId))
}

// ============================================================
// LETTER-LEVEL POSTCARD DRAFT (2026-09-13) — deliberately a SEPARATE
// localStorage key from correspondenceDraftKey above, never folded into
// the ProseMirror doc JSON: a Postcard is now a letter-level enclosure,
// not paragraph-positioned content, so it has no natural home inside the
// editor document at all (see lib/moments.ts's own LetterPostcardDraft
// doc comment for the full product-model reasoning). Keeping it in its
// own key/state means removing the Postcard, or a failure while writing
// one, can never alter a single word of the letter's own text or its
// Photo Moments, and vice versa — the two survive/clear completely
// independently, including across a refresh.
// ============================================================

function correspondencePostcardDraftKey(correspondenceId: string): string {
  return `tempa-letter-postcard-draft:${correspondenceId}`
}

/** Reads the current letter-level Postcard draft, or null when there is
 * none (never asked for, removed, or never persisted because storage
 * failed) — same fail-safe-to-null convention as every other read
 * function in this file. */
export function readLetterPostcardDraft(correspondenceId: string): LetterPostcardDraft | null {
  try {
    const raw = window.localStorage.getItem(correspondencePostcardDraftKey(correspondenceId))
    if (!raw) return null
    return JSON.parse(raw) as LetterPostcardDraft
  } catch {
    return null
  }
}

/** Pass null to clear — mirrors writeDraft's own "nothing to persist"
 * convention above, so removing the Postcard and letting its draft
 * expire naturally go through the exact same call, never two different
 * code paths that could drift apart. */
export function writeLetterPostcardDraft(correspondenceId: string, draft: LetterPostcardDraft | null): void {
  try {
    const key = correspondencePostcardDraftKey(correspondenceId)
    if (draft === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, JSON.stringify(draft))
    }
  } catch {
    // ignore storage failures (e.g. private browsing quota)
  }
}

export function clearLetterPostcardDraft(correspondenceId: string): void {
  clearDraft(correspondencePostcardDraftKey(correspondenceId))
}

function firstContactDraftKey(recipientId: string): string {
  return `tempa-first-letter-editor-draft:${recipientId}`
}

/**
 * The very first letter to someone, before any correspondence exists.
 * Scoped by recipientId (never a shared/global key) so a draft begun
 * for one recipient cannot leak into a different recipient's composer
 * — each recipient gets an entirely separate localStorage entry, the
 * same isolation correspondence-scoped drafts already have from each
 * other.
 */
export function readFirstContactDraft(recipientId: string): LetterDocJSON | null {
  return readDraft(firstContactDraftKey(recipientId))
}

export function writeFirstContactDraft(recipientId: string, doc: LetterDocJSON): void {
  writeDraft(firstContactDraftKey(recipientId), doc)
}

export function clearFirstContactDraft(recipientId: string): void {
  clearDraft(firstContactDraftKey(recipientId))
}

function dispatchDraftKey(authorId: string): string {
  return `tempa-dispatch-draft:${authorId}`
}

export type DispatchDraft = {
  title: string
  doc: LetterDocJSON
  topics: string[]
}

/**
 * A Dispatch, before it's ever published — there is no server-side
 * draft row at all (see docs/sql/2026-09-07-dispatches-and-board.sql's
 * own doc comment); this localStorage entry is the only place an
 * in-progress Dispatch exists until Publish. Scoped by authorId rather
 * than a single shared key, matching every other scope here — a member
 * is never left holding a stranger's in-progress draft on a shared
 * device. Carries title and topics alongside the document, unlike the
 * other three scopes, since a Dispatch is more than just a body.
 */
export function readDispatchDraft(authorId: string): DispatchDraft | null {
  try {
    const raw = window.localStorage.getItem(dispatchDraftKey(authorId))
    if (!raw) return null
    return JSON.parse(raw) as DispatchDraft
  } catch {
    return null
  }
}

/** Empty (no title text, no body content, no topics) is treated as
 * "nothing to save," same as every other scope's LetterDocJSON-only
 * emptiness rule — never persists an all-blank draft that would only
 * ever restore to nothing. */
export function writeDispatchDraft(authorId: string, draft: DispatchDraft): void {
  try {
    const isEmpty =
      draft.title.trim().length === 0 && !letterDocHasContent(draft.doc) && draft.topics.length === 0
    if (isEmpty) {
      window.localStorage.removeItem(dispatchDraftKey(authorId))
    } else {
      window.localStorage.setItem(dispatchDraftKey(authorId), JSON.stringify(draft))
    }
  } catch {
    // ignore storage failures (e.g. private browsing quota)
  }
}

export function clearDispatchDraft(authorId: string): void {
  clearDraft(dispatchDraftKey(authorId))
}

// ============================================================
// DISPATCH POSTCARD DRAFT (Dispatch Postcards Checkpoint 2) —
// deliberately a SEPARATE localStorage key from dispatchDraftKey above,
// mirroring correspondencePostcardDraftKey's own reasoning exactly: a
// Postcard is a Dispatch-level enclosure, not part of the ProseMirror
// document, so it has no natural home inside DispatchDraft's own `doc`
// field. Scoped by authorId, same as dispatchDraftKey, since a Dispatch
// draft has no correspondence/letter id to key on before it's published.
// CREATE MODE ONLY — an edit-mode Dispatch's already-published Postcard
// is immutable and never goes through this draft mechanism at all.
// ============================================================

function dispatchPostcardDraftKey(authorId: string): string {
  return `tempa-dispatch-postcard-draft:${authorId}`
}

/** Reads the current unpublished Dispatch's Postcard draft, or null when
 * there is none — same fail-safe-to-null convention as every other read
 * function in this file. */
export function readDispatchPostcardDraft(authorId: string): LetterPostcardDraft | null {
  try {
    const raw = window.localStorage.getItem(dispatchPostcardDraftKey(authorId))
    if (!raw) return null
    return JSON.parse(raw) as LetterPostcardDraft
  } catch {
    return null
  }
}

/** Pass null to clear — mirrors writeLetterPostcardDraft's own "nothing
 * to persist" convention above. */
export function writeDispatchPostcardDraft(authorId: string, draft: LetterPostcardDraft | null): void {
  try {
    const key = dispatchPostcardDraftKey(authorId)
    if (draft === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, JSON.stringify(draft))
    }
  } catch {
    // ignore storage failures (e.g. private browsing quota)
  }
}

export function clearDispatchPostcardDraft(authorId: string): void {
  clearDraft(dispatchPostcardDraftKey(authorId))
}
