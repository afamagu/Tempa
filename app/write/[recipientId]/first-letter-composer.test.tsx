import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import FirstLetterComposer from './first-letter-composer'

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

// Send-button regression (2026-09-05) — the actual fix (canSendLetter,
// shouldRerenderOnTransaction) is covered directly by
// lib/letter-editor-doc.test.ts's canSendLetter suite, since exercising
// live typing/Bold/Italic/Emoji through a real ProseMirror EditorView
// needs a DOM this project's Vitest environment deliberately doesn't
// provide (environment: 'node' — see vitest.config.mts). This is a
// narrower smoke test: the composer's very first render (before the
// Tiptap editor instance exists yet — immediatelyRender: false is
// specifically for this) must render safely and start with Send
// correctly disabled, never crash and never default to enabled.
describe('FirstLetterComposer — initial render (editor not yet mounted)', () => {
  it('renders without crashing and starts with Send disabled', () => {
    const html = renderToStaticMarkup(
      <FirstLetterComposer
        recipientId="recipient-1"
        recipientPseudonym="Evening Quill"
        questionAnswerId="answer-1"
        questionPrompt="What is something ordinary that means more to you than most people would expect?"
      />
    )
    expect(html).toContain('Send letter')
    // The disabled attribute is written before the button's text
    // content in the serialized HTML — assert on the whole <button>
    // element that contains "Send letter", not text-then-attribute order.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Send letter<\/button>/)
  })

  it('shows the recipient pseudonym and the originating Question prompt', () => {
    const html = renderToStaticMarkup(
      <FirstLetterComposer
        recipientId="recipient-1"
        recipientPseudonym="Evening Quill"
        questionAnswerId="answer-1"
        questionPrompt="A prompt"
      />
    )
    expect(html).toContain('Evening Quill')
    expect(html).toContain('A prompt')
  })
})
