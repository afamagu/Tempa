import type { Editor } from '@tiptap/core'
import type { LetterDocJSON } from './letter-editor-doc'

export const INPUT_NOT_READY = 'Your keyboard is still finishing that word. Please try again.'
export const DRAFT_CHANGED = 'Your draft changed. Please review it and send again.'

/** Blur commits native predictions/composition. Allow the editor's own DOM
 * observer and input handlers to finish; never force its private IME state. */
export async function settleWritingInput(editor: Editor): Promise<LetterDocJSON> {
  if (editor.isDestroyed) throw new Error(INPUT_NOT_READY)
  const dom = editor.view.dom
  if (dom.contains(document.activeElement)) dom.blur()
  const started = Date.now()
  do {
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    if (editor.isDestroyed) throw new Error(INPUT_NOT_READY)
    if (!editor.view.composing) {
      // A compositionend/beforeinput observer may commit on the next task.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      if (editor.isDestroyed) throw new Error(INPUT_NOT_READY)
      if (!editor.view.composing) return editor.getJSON() as LetterDocJSON
    }
  } while (Date.now() - started < 1200)
  throw new Error(INPUT_NOT_READY)
}
