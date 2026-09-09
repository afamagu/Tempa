import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import FirstContactResponse from './first-contact-response'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

// Send-button reactivity audit (2026-09-05) — FirstContactResponse's
// reply mode shared the exact same missing shouldRerenderOnTransaction
// as first-letter-composer.tsx, now fixed with the same canSendLetter
// derivation (covered exhaustively by lib/letter-editor-doc.test.ts).
//
// This component's Tiptap editor only mounts once mode advances from
// 'choose' to 'reply' via a button click — renderToStaticMarkup has no
// interactivity (this codebase's established Vitest convention has no
// DOM-mounting/simulated-click library), so the reply mode's own
// render cannot be exercised here. This is the same structural
// limitation already accepted for every other click-gated disclosure
// in this codebase (Tooltip, LetterActionMenu, EmojiPicker's open
// state). What IS verified: the component's default (pre-click)
// render is safe and offers the two real actions; full reply-mode
// confirmation is a live-test item, same as the underlying editor
// interactivity itself.
describe('FirstContactResponse — default (choose) mode', () => {
  it('renders without crashing and offers Reply and Pass on this letter', () => {
    const html = renderToStaticMarkup(
      <FirstContactResponse letterId="letter-1" correspondenceId="corr-1" recipientPseudonym="Evening Quill" />
    )
    expect(html).toContain('Reply')
    expect(html).toContain('Pass on this letter')
  })

  it('does not render the editor/Send-reply button before Reply is chosen', () => {
    const html = renderToStaticMarkup(
      <FirstContactResponse letterId="letter-1" correspondenceId="corr-1" recipientPseudonym="Evening Quill" />
    )
    expect(html).not.toContain('Send reply')
  })

  // Length-policy audit (2026-09-05): this reply establishes the
  // correspondence and is now treated as a genuine, unlimited
  // correspondence letter (see canSendLetter's { aboveMax: false }
  // call in first-contact-response.tsx) — never a fake/displayed
  // limit. The reply mode itself is click-gated and unreachable here
  // (see this file's own doc comment), so this only guards the always-
  // rendered default mode against ever regaining one.
  it('never shows a character-count/limit indicator, in the default mode', () => {
    const html = renderToStaticMarkup(
      <FirstContactResponse letterId="letter-1" correspondenceId="corr-1" recipientPseudonym="Evening Quill" />
    )
    expect(html).not.toMatch(/\/\s*4,?000/)
    expect(html).not.toMatch(/\/\s*2,?000/)
  })
})
