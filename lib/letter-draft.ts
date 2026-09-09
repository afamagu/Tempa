// A per-correspondence reply-body draft — text only (Moments/photos are
// not serialized; re-attaching a photo after a real interruption is a
// small ask, losing the words someone wrote is not). Client-only,
// low-stakes, per-device convenience, same category of trade-off as the
// existing per-question draft in app/question/question-answer.tsx —
// this reuses that same pattern rather than inventing a second one.

function draftKey(correspondenceId: string): string {
  return `tempa-letter-draft:${correspondenceId}`
}

export function readLetterDraft(correspondenceId: string): string | null {
  try {
    return window.localStorage.getItem(draftKey(correspondenceId))
  } catch {
    return null
  }
}

export function writeLetterDraft(correspondenceId: string, body: string): void {
  try {
    if (body.trim().length === 0) {
      window.localStorage.removeItem(draftKey(correspondenceId))
    } else {
      window.localStorage.setItem(draftKey(correspondenceId), body)
    }
  } catch {
    // ignore storage failures (e.g. private browsing quota)
  }
}

export function clearLetterDraft(correspondenceId: string): void {
  try {
    window.localStorage.removeItem(draftKey(correspondenceId))
  } catch {
    // ignore
  }
}
