// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor, Node } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { MomentAffordance } from '@/app/letters/[letterId]/moment-affordance-extension'

const Photo = Node.create({ name: 'photoMoment', inline: true, group: 'inline', atom: true,
  parseHTML: () => [{ tag: 'span[data-photo-moment]' }], renderHTML: () => ['span', { 'data-photo-moment': '' }],
})
function makeEditor(dispatch: boolean) {
  return new Editor({ element: document.createElement('div'), injectCSS: false,
    extensions: [Document, Paragraph, Text, Photo, MomentAffordance.configure({ enabled: true, allowMultiplePhotos: dispatch, allParagraphs: dispatch })],
    content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'First' }, { type: 'photoMoment' }, { type: 'photoMoment' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Last' }] },
    ] },
  })
}
describe('Dispatch attachment controls', () => {
  it('keeps an Add photo control on an occupied passage and on the current and following paragraphs', () => {
    const editor = makeEditor(true)
    try {
      editor.commands.setTextSelection(1)
      expect(editor.view.dom.querySelectorAll('button[aria-label="Add a photo to this paragraph"]')).toHaveLength(3)
    } finally { editor.destroy() }
  })
  it('preserves the existing private-letter controls', () => {
    const editor = makeEditor(false)
    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1)
      expect(editor.view.dom.querySelectorAll('button[aria-label="Add a photo to this paragraph"]')).toHaveLength(1)
    } finally { editor.destroy() }
  })
})
