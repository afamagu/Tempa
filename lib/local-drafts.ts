/**
 * Pre-beta security F-15 — private drafts (letters, first letters, answers,
 * Dispatches, their postcards) are kept in this browser's localStorage
 * while a member writes. They must not outlive the member's session on a
 * shared device: explicit sign-out and account closure clear them.
 *
 * Every Tempa draft key uses the `tempa-<kind>-draft:` namespace
 * (lib/letter-draft.ts, lib/letter-editor-draft.ts,
 * app/question/question-answer.tsx). Only those keys are removed; nothing
 * else in storage is touched.
 */
export const TEMPA_DRAFT_KEY = /^tempa-[a-z-]+-draft:/

/** The marker sign-out adds to its /sign-in redirect. */
export const SIGNED_OUT_PARAM = 'signed_out'

export function clearTempaLocalDrafts(storage: Storage | null | undefined = typeof window === 'undefined' ? null : window.localStorage): number {
  if (!storage) return 0
  try {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key && TEMPA_DRAFT_KEY.test(key)) keys.push(key)
    }
    keys.forEach((key) => storage.removeItem(key))
    return keys.length
  } catch {
    // Storage can be unavailable (privacy modes); nothing to clear then.
    return 0
  }
}
