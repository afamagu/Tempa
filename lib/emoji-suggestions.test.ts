// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { baseWritingExtensions } from '@/app/letters/writing-extensions'
import { emojiSuggestionAt } from './emoji-suggestions'

let editor: Editor
afterEach(() => editor?.destroy())
function setup(text: string) {
  editor = new Editor({ extensions: baseWritingExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } })
  editor.commands.setTextSelection(text.length + 1)
}
describe('selectable emoji suggestions', () => {
  it('offers LOL choices without changing the typed words', () => {
    setup('That was funny LOL')
    const suggestion = emojiSuggestionAt(editor.state)!
    expect(suggestion.choices.map((c) => c.emoji)).toEqual(['😂', '🤣', '😄'])
    expect(editor.getText()).toBe('That was funny LOL')
  })
  it('replaces only the selected word, preserves punctuation and supports Undo', () => {
    setup('That was funny lol! ')
    const suggestion = emojiSuggestionAt(editor.state)!
    editor.commands.insertContentAt({ from: suggestion.from, to: suggestion.to }, '😂')
    expect(editor.getText()).toBe('That was funny 😂! ')
    editor.commands.undo()
    expect(editor.getText()).toBe('That was funny lol! ')
  })
  it('does not suggest inside another word, mid-word, across paragraphs or on a selection', () => {
    setup('lollipop'); expect(emojiSuggestionAt(editor.state)).toBeNull()
    editor.commands.setTextSelection(4); expect(emojiSuggestionAt(editor.state)).toBeNull()
    editor.commands.setContent('<p>lo</p><p>l</p>'); editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    expect(emojiSuggestionAt(editor.state)).toBeNull()
    editor.commands.setContent('<p>lol</p>'); editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 4)))
    expect(emojiSuggestionAt(editor.state)).toBeNull()
  })
  it('preserves formatting when the member chooses an emoji', () => {
    setup('lol')
    editor.commands.selectAll(); editor.commands.toggleBold(); editor.commands.setTextSelection(4)
    const suggestion = emojiSuggestionAt(editor.state)!
    editor.commands.insertContentAt({ from: suggestion.from, to: suggestion.to }, '😂')
    expect(editor.getJSON().content?.[0].content?.[0]).toMatchObject({ text: '😂', marks: [{ type: 'bold' }] })
  })
})
