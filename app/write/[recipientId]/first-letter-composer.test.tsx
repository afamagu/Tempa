import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Post-onboarding corrections checkpoint (Section E) — a live smoke test
// found the first-contact Sent screen still said "Back to Minds" after
// the People rename. Client component with Tiptap's useEditor and a
// network-driven `sent` state that can't be reached via
// renderToStaticMarkup (same "not directly render-tested" convention as
// every other stateful client composer in this codebase) — proven via
// source inspection instead.
const source = readFileSync(path.join(__dirname, 'first-letter-composer.tsx'), 'utf8')

describe('FirstLetterComposer — "Minds" renamed to "People" in user-visible copy (Section E)', () => {
  it('never shows "Back to Minds" anywhere — neither the pre-send composer nor the post-send Sent screen', () => {
    expect(source).not.toContain('Back to Minds')
  })

  it('both "Back" links say "Back to People", still pointing at the unchanged /minds route', () => {
    const matches = source.match(/Back to People/g) ?? []
    expect(matches.length).toBe(2)
    // The internal route itself is deliberately unchanged — only the
    // user-visible label moved.
    expect(source).toContain('href="/minds"')
    expect((source.match(/href="\/minds"/g) ?? []).length).toBe(2)
  })

  it('the Sent screen (rendered when sent === true) is the one with "Back to People", not just the pre-send toolbar', () => {
    const sentBlockStart = source.indexOf('if (sent) {')
    const sentBlockEnd = source.indexOf('\n  }\n', sentBlockStart)
    expect(source.slice(sentBlockStart, sentBlockEnd)).toContain('Back to People')
  })
})

// Safety 2, Checkpoint 3 — same source-inspection convention as this
// file's own established tests above: a client composer's actual
// submit flow (evaluate -> gate -> mutate) can't be exercised via
// renderToStaticMarkup, so its structure is proven from source instead.
describe('FirstLetterComposer — Safety-gated send (Checkpoint 3)', () => {
  it('evaluates via evaluateSafety before ever calling send_first_letter', () => {
    const evaluateIndex = source.indexOf('evaluateSafety({')
    const rpcIndex = source.indexOf("supabase.rpc('send_first_letter'")
    expect(evaluateIndex, 'expected a call to evaluateSafety').toBeGreaterThan(-1)
    expect(rpcIndex, 'expected a call to send_first_letter').toBeGreaterThan(-1)
    expect(evaluateIndex).toBeLessThan(rpcIndex)
  })

  it('a failed evaluation (status: error) never falls through to send_first_letter — fails closed', () => {
    const handleSendBody = source.slice(source.indexOf('async function handleSend()'), source.indexOf('async function sendLetter'))
    expect(handleSendBody).toContain("outcome.status === 'error'")
    expect(handleSendBody).not.toContain("supabase.rpc('send_first_letter'")
  })

  it('cannot_send blocks inline with no SafetyWarningDialog involved, and no bypass', () => {
    const handleSendBody = source.slice(source.indexOf('async function handleSend()'), source.indexOf('async function sendLetter'))
    expect(handleSendBody).toContain("outcome.status === 'cannot_send'")
    expect(handleSendBody).toContain('SAFETY_CANNOT_SEND_MESSAGE')
  })

  it('warning_required opens the shared SafetyWarningDialog, gated on the member\'s own explicit acknowledgement', () => {
    expect(source).toContain('<SafetyWarningDialog')
    expect(source).toContain('open={pendingWarning !== null}')
    expect(source).toContain('onAcknowledgeAndSend={handleAcknowledgeWarning}')
  })

  it('passes p_safety_evaluation_id and p_warning_acknowledged to send_first_letter — the new required parameters', () => {
    const sendLetterBody = source.slice(source.indexOf('async function sendLetter'), source.indexOf('if (sent) {'))
    expect(sendLetterBody).toContain('p_safety_evaluation_id: safetyEvaluationId')
    expect(sendLetterBody).toContain('p_warning_acknowledged: warningAcknowledged')
  })

  it('re-reads the editor fresh inside sendLetter rather than trusting a value captured before the warning dialog opened', () => {
    const sendLetterBody = source.slice(source.indexOf('async function sendLetter'), source.indexOf('if (sent) {'))
    expect(sendLetterBody).toContain('docToPlainBody(editor.getJSON()')
  })
})
