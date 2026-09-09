/**
 * Pure: inserts `insertText` at a plain `<textarea>`'s current
 * selection, replacing any selected range — the same behavior typing
 * a character would have. Used by the Question editor's emoji picker
 * (app/question/question-answer.tsx), which stays a plain textarea
 * rather than a Tiptap editor (see docs/tempa-build-guide.md's
 * writing-essentials section for why) but still needs "insert at the
 * current cursor position" for its emoji picker, without any Tiptap
 * dependency. Returns the new full value and where the cursor should
 * land afterward (immediately after the inserted text), so the caller
 * can restore both in one place.
 */
export function insertAtCursor(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  insertText: string
): { value: string; cursor: number } {
  const before = value.slice(0, selectionStart)
  const after = value.slice(selectionEnd)
  return {
    value: before + insertText + after,
    cursor: before.length + insertText.length,
  }
}
