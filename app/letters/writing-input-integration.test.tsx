// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseWritingExtensions } from './writing-extensions'
import { useWritingDraft } from './use-writing-draft'
import { useWritingState } from './use-writing-state'
import EmojiSuggestions from './emoji-suggestions'
import { readLetterEditorDraft, writeLetterEditorDraft } from '@/lib/letter-editor-draft'
import { type LetterDocJSON } from '@/lib/letter-editor-doc'

let editor: Editor
let root: Root
let host: HTMLDivElement
afterEach(async () => {
  if (root) await act(() => root.unmount())
  editor?.destroy()
  host?.remove()
  localStorage.clear()
  vi.useRealTimers()
})
async function mount(component: (editor: Editor) => React.ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  editor = new Editor({ extensions: baseWritingExtensions(), content: '<p>Words</p>' })
  document.body.append(editor.view.dom)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(() => root.render(component(editor)))
}

describe('shared writing integration', () => {
  it('does not rerender a composer for typing or selection while eligibility is unchanged', async () => {
    let renders = 0
    function Surface({ current }: { current: Editor }) {
      renders++
      const state = useWritingState(current)
      return <button disabled={!state.hasContent}>Send</button>
    }
    await mount((current) => <Surface current={current} />)
    const initial = renders
    await act(() => {
      editor.commands.setContent('<p>' + 'A long letter. '.repeat(2500) + '</p>')
      for (let i = 1; i < 10; i++) editor.commands.setTextSelection(i)
      editor.commands.insertContent(' More words')
    })
    expect(renders).toBe(initial)
    await act(() => editor.commands.clearContent())
    expect(host.querySelector('button')?.disabled).toBe(true)
    expect(renders).toBeGreaterThan(initial)
  })
  it('flushes the latest draft on pagehide and leaves no delayed save after successful Send', async () => {
    vi.useFakeTimers()
    let controls: ReturnType<typeof useWritingDraft>
    function Surface({ current }: { current: Editor }) {
      const [failed, setFailed] = useState(false)
      controls = useWritingDraft(current, (e) => writeLetterEditorDraft('corr', e.getJSON() as LetterDocJSON), () => setFailed(true), 'corr')
      return <span>{String(failed)}</span>
    }
    await mount((current) => <Surface current={current} />)
    await act(() => editor.commands.setContent('<p>Last word before leaving</p>'))
    expect(readLetterEditorDraft('corr')).toBeNull()
    await act(() => window.dispatchEvent(new Event('pagehide')))
    expect(readLetterEditorDraft('corr')?.content?.[0].content?.[0]).toMatchObject({ text: 'Last word before leaving' })
    await act(() => {
      editor.commands.insertContent('!')
      controls.cancel()
      localStorage.removeItem('tempa-letter-editor-draft:corr')
      vi.runAllTimers()
    })
    expect(readLetterEditorDraft('corr')).toBeNull()
  })
  it('renders selectable LOL choices, keeps text until selection, and inserts the chosen emoji', async () => {
    await mount((current) => <EmojiSuggestions editor={current} />)
    await act(() => {
      editor.commands.setContent('<p>That was funny LOL</p>')
      editor.commands.setTextSelection(editor.state.doc.content.size - 1)
      editor.view.dom.focus()
    })
    expect(host.querySelectorAll('button')).toHaveLength(3)
    expect(editor.getText()).toBe('That was funny LOL')
    await act(() => (host.querySelector('button') as HTMLButtonElement).click())
    expect(editor.getText()).toBe('That was funny 😂')
  })
})
