import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import FirstContactResponse from './first-contact-response'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

const baseProps = {
  letterId: 'letter-1',
  correspondenceId: 'corr-1',
  recipientPseudonym: 'Evening Quill',
  viewerId: 'viewer-1',
  sourceLetterBody: 'Dear friend,\n\nHope this finds you well.',
  sourceLetterMoments: [],
}

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
// state) — including the new "View [pseudonym]'s letter" button below,
// which only renders once reply mode is reached. What IS verified: the
// component's default (pre-click) render is safe and offers the two
// real actions; full reply-mode confirmation (including the source-
// letter reference button, and that opening/closing it survives the
// live draft) is a live-test item, same as the underlying editor
// interactivity itself.
describe('FirstContactResponse — default (choose) mode', () => {
  it('renders without crashing and offers Reply and Pass on this letter', () => {
    const html = renderToStaticMarkup(<FirstContactResponse {...baseProps} />)
    expect(html).toContain('Reply')
    expect(html).toContain('Pass on this letter')
  })

  it('does not render the editor/Send-reply button before Reply is chosen', () => {
    const html = renderToStaticMarkup(<FirstContactResponse {...baseProps} />)
    expect(html).not.toContain('Send reply')
  })

  it('does not render the "View [pseudonym]\'s letter" reference action before Reply is chosen', () => {
    const html = renderToStaticMarkup(<FirstContactResponse {...baseProps} />)
    expect(html).not.toContain(`View ${baseProps.recipientPseudonym}`)
  })

  // Length-policy audit (2026-09-05): this reply establishes the
  // correspondence and is now treated as a genuine, unlimited
  // correspondence letter (see canSendLetter's { aboveMax: false }
  // call in first-contact-response.tsx) — never a fake/displayed
  // limit. The reply mode itself is click-gated and unreachable here
  // (see this file's own doc comment), so this only guards the always-
  // rendered default mode against ever regaining one.
  it('never shows a character-count/limit indicator, in the default mode', () => {
    const html = renderToStaticMarkup(<FirstContactResponse {...baseProps} />)
    expect(html).not.toMatch(/\/\s*4,?000/)
    expect(html).not.toMatch(/\/\s*2,?000/)
  })

  it('renders a closed (invisible) reference panel by default — never open before the member asks for it', () => {
    const html = renderToStaticMarkup(<FirstContactResponse {...baseProps} />)
    expect(html).not.toContain('aria-modal')
    expect(html).not.toContain(`${baseProps.recipientPseudonym}&rsquo;s letter`)
  })
})

// Safety 2, Checkpoint 3 — same source-inspection convention as
// first-letter-composer.test.tsx's own identical block; the interactive
// submit flow (evaluate -> gate -> mutate) is unreachable via
// renderToStaticMarkup for the same click-gated-editor reason already
// documented at the top of this file.
describe('FirstContactResponse — Safety-gated reply (Checkpoint 3)', () => {
  const source = readFileSync(path.join(__dirname, 'first-contact-response.tsx'), 'utf8')

  it('evaluates via evaluateSafety before ever calling reply_to_letter, with surface: reply and no Postcard', () => {
    const evaluateIndex = source.indexOf("evaluateSafety({ surface: 'reply', letterId, body })")
    const rpcIndex = source.indexOf("supabase.rpc('reply_to_letter'")
    expect(evaluateIndex, 'expected a call to evaluateSafety').toBeGreaterThan(-1)
    expect(rpcIndex, 'expected a call to reply_to_letter').toBeGreaterThan(-1)
    expect(evaluateIndex).toBeLessThan(rpcIndex)
  })

  it('a failed evaluation (status: error) never falls through to reply_to_letter — fails closed', () => {
    const handleReplyBody = source.slice(source.indexOf('async function handleReply()'), source.indexOf('async function sendReply'))
    expect(handleReplyBody).toContain("outcome.status === 'error'")
    expect(handleReplyBody).not.toContain("supabase.rpc('reply_to_letter'")
  })

  it('warning_required opens the shared SafetyWarningDialog', () => {
    expect(source).toContain('<SafetyWarningDialog')
    expect(source).toContain('open={pendingWarning !== null}')
    expect(source).toContain('onAcknowledgeAndSend={handleAcknowledgeWarning}')
  })

  it('passes p_safety_evaluation_id and p_warning_acknowledged to reply_to_letter', () => {
    const sendReplyBody = source.slice(source.indexOf('async function sendReply'), source.indexOf('async function handleClose'))
    expect(sendReplyBody).toContain('p_safety_evaluation_id: safetyEvaluationId')
    expect(sendReplyBody).toContain('p_warning_acknowledged: warningAcknowledged')
  })
})
