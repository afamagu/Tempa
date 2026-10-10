// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseWritingExtensions } from '@/app/letters/writing-extensions'
import { settleWritingInput, INPUT_NOT_READY } from './settle-writing-input'

let editor: Editor
afterEach(() => editor?.destroy())
function setup() {
  // jsdom has no layout; ProseMirror needs Range geometry for IME setup.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  const element = document.createElement('div'); document.body.append(element)
  editor = new Editor({ element, extensions: baseWritingExtensions(), content: '<p>Before prediction</p>' })
  editor.view.dom.focus()
}
describe('native input snapshot', () => {
  it('captures the prediction committed by blur instead of the earlier text', async () => {
    setup()
    editor.view.dom.addEventListener('blur', () => editor.commands.setContent('<p>Final prediction</p>'), { once: true })
    const doc = await settleWritingInput(editor)
    expect(doc.content?.[0].content?.[0]).toMatchObject({ text: 'Final prediction' })
  })
  it('waits for native composition to finish and reads the final words', async () => {
    setup()
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    setTimeout(() => {
      editor.commands.setContent('<p>Committed words</p>')
      editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    }, 40)
    const doc = await settleWritingInput(editor)
    expect(doc.content?.[0].content?.[0]).toMatchObject({ text: 'Committed words' })
  })
  it('rejects a destroyed editor rather than sending an old snapshot', async () => {
    setup(); editor.destroy()
    await expect(settleWritingInput(editor)).rejects.toThrow(INPUT_NOT_READY)
  })
})
