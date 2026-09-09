import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import LetterPreview from './letter-preview'
import { POSTCARD_CATALOG, type Moment } from '@/lib/moments'

const SOURCE_PATH = path.join(__dirname, 'letter-preview.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

// Strips comments before a blanket scan — this file's own doc comment
// legitimately names PostcardObject/Living Reveal/Turn over/Replay by
// name to explain the z-index layering with MomentDisplay's own
// overlay (which LetterBody, unmodified, already opens for a postcard
// Moment) — documentation, never actual code importing/defining one.
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}
const codeOnly = stripComments(source)

function renderPreview(overrides: Partial<Parameters<typeof LetterPreview>[0]> = {}) {
  return renderToStaticMarkup(
    <LetterPreview
      body={'Dear friend,\n\nHere is a photo.'}
      moments={[]}
      postcard={null}
      senderPseudonym="Morning Larch"
      recipientPseudonym="Evening Quill"
      onClose={() => {}}
      onSend={() => {}}
      sending={false}
      {...overrides}
    />
  )
}

// K. Preview renders using the real production LetterBody, never a fake
// visual approximation.
describe('LetterPreview — K. uses the real production LetterBody', () => {
  it('imports and renders the actual LetterBody component', () => {
    expect(source).toContain("import LetterBody from './letter-body'")
    expect(source).toContain('<LetterBody body={body} moments={moments} />')
  })

  it('never defines its own paragraph-rendering or Moment-rendering markup — no duplicated reading grammar', () => {
    expect(source).not.toContain('bg-surface-shell')
    expect(source).not.toContain('whitespace-pre-wrap')
  })

  it('the rendered letter text actually appears, proving LetterBody is genuinely invoked, not stubbed', () => {
    const html = renderPreview({ body: 'Dear friend,\n\nHere is a photo.' })
    expect(html).toContain('Dear friend,')
    expect(html).toContain('Here is a photo.')
  })
})

// L. Current Photo Moments appear in Preview.
describe('LetterPreview — L. Photo Moments appear', () => {
  it('a photo Moment renders as the real inline PhotoMomentToken', () => {
    const moments: Moment[] = [
      { id: 'm-1', position: 0, type: 'photo', imageUrl: 'blob:http://localhost/preview-1', postcardKey: null },
    ]
    const html = renderPreview({ body: 'One paragraph.', moments })
    expect(html).toContain('aria-label="Open this photo"')
    expect(html).toContain('blob:http://localhost/preview-1')
  })

  it('multiple photo Moments across paragraphs all appear', () => {
    const moments: Moment[] = [
      { id: 'm-1', position: 0, type: 'photo', imageUrl: 'blob:http://localhost/1', postcardKey: null },
      { id: 'm-2', position: 1, type: 'photo', imageUrl: 'blob:http://localhost/2', postcardKey: null },
    ]
    const html = renderPreview({ body: 'First.\n\nSecond.', moments })
    expect((html.match(/aria-label="Open this photo"/g) ?? []).length).toBe(2)
  })
})

// M/N. The current Postcard appears in Preview, through the real
// MomentDisplay/PostcardObject chain — never a special Preview-only
// Postcard rendering.
describe('LetterPreview — M/N. the current Postcard appears, via the real PostcardObject chain', () => {
  it('a postcard Moment renders through MomentDisplay, showing the real catalog front image', () => {
    const moments: Moment[] = [
      { id: 'm-1', position: 0, type: 'postcard', imageUrl: null, postcardKey: 'bangkokAfterRain' },
    ]
    const html = renderPreview({ body: 'One paragraph.', moments })
    expect(html).toContain(POSTCARD_CATALOG.bangkokAfterRain.frontImagePath)
  })

  it('a legacy inline postcardMoment still renders inline, exactly where LetterBody places it, never in the new letterhead slot', () => {
    const moments: Moment[] = [
      { id: 'm-1', position: 0, type: 'postcard', imageUrl: null, postcardKey: 'bangkokAfterRain' },
    ]
    const html = renderPreview({ body: 'One paragraph.', moments, postcard: null })
    expect(html).toContain(POSTCARD_CATALOG.bangkokAfterRain.frontImagePath)
  })
})

// Letter-Level Postcards V1 (2026-09-13) — H/I/J. The NEW letter-level
// Postcard renders in its own canonical letterhead slot, through the
// real LetterheadPostcard/PostcardObject chain, never inline in
// LetterBody's own paragraph positions and never a Preview-only
// reimplementation.
describe('LetterPreview — H/I/J. the new letter-level Postcard renders in the canonical letterhead slot', () => {
  it('H/J. uses the shared LetterheadPostcard component — the same one the delivered reader uses — never inventing its own Postcard markup', () => {
    expect(source).toContain("import LetterheadPostcard from '@/app/letters/letterhead-postcard'")
    expect(source).toContain('<LetterheadPostcard')
  })

  it('H. a letter-level Postcard draft renders the real catalog front image', () => {
    const html = renderPreview({
      body: 'One paragraph.',
      postcard: { postcardKey: 'bangkokAfterRain', revealLine: '', backMessage: '' },
    })
    expect(html).toContain(POSTCARD_CATALOG.bangkokAfterRain.frontImagePath)
  })

  it('I. renders the letter-level Postcard OUTSIDE LetterBody — never as one of its own moments-array entries', () => {
    expect(codeOnly).toMatch(/<LetterheadPostcard[\s\S]*<LetterBody/)
  })

  it('no letter-level Postcard renders nothing extra — a plain text-only preview stays exactly that', () => {
    const html = renderPreview({ body: 'Just words.', postcard: null })
    expect(html).not.toContain('postcard')
  })
})

// O. Sender can return from Preview without losing draft state
// structurally — Preview never touches editor/draft state at all.
describe('LetterPreview — O. no destructive rehydration on close/back', () => {
  it('never calls setContent, or reads/writes any draft — it is a pure presentational overlay', () => {
    expect(source).not.toContain('setContent')
    expect(source).not.toContain('readLetterEditorDraft')
    expect(source).not.toContain('writeLetterEditorDraft')
    expect(source).not.toContain('localStorage')
  })

  it('both Close (top) and "Back to letter" (bottom) call the exact same onClose callback — no divergent behavior', () => {
    expect(source).toContain('onClick={onClose}')
    const closeCount = (source.match(/onClick=\{onClose\}/g) ?? []).length
    expect(closeCount).toBe(2)
  })

  it('renders no destructive action of its own — no delete/discard/clear affordance', () => {
    const html = renderPreview()
    expect(html.toLowerCase()).not.toContain('discard')
    expect(html.toLowerCase()).not.toContain('clear draft')
  })
})

// P/Q. Preview Send reuses the canonical existing send action; Preview
// itself has no send/RPC logic and creates no delivery side effect.
describe('LetterPreview — P/Q. Send is reused via onSend, never re-implemented', () => {
  it('has no RPC/Supabase call of its own — sending is entirely the caller\'s responsibility via onSend', () => {
    expect(source).not.toContain('supabase')
    expect(source).not.toContain('.rpc(')
    expect(source).not.toContain('write_letter')
  })

  it('the Send letter button calls onSend directly, with no wrapper logic in between', () => {
    expect(source).toContain('onClick={onSend}')
  })

  it('the Send letter button is disabled while sending, preventing duplicate submission', () => {
    const html = renderPreview({ sending: true })
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*Sending…[\s\S]*<\/button>/)
  })

  // Send-feedback audit (2026-09-13) — a restrained, existing-utility
  // (Tailwind's own animate-pulse) motion cue during the wait, never a
  // new spinner/progress-bar component.
  it('shows a restrained animated cue on the Sending… label, never a loud progress indicator', () => {
    const html = renderPreview({ sending: true })
    expect(html).toContain('animate-pulse')
    expect(html.toLowerCase()).not.toMatch(/progress|spinner/)
  })

  it('shows no animated cue at all once not sending', () => {
    const html = renderPreview({ sending: false })
    expect(html).not.toContain('animate-pulse')
  })

  it('shows an error passed through from the caller without hiding the letter or falsely implying success', () => {
    const html = renderPreview({ error: 'Could not send your letter. Please try again.' })
    expect(html).toContain('Could not send your letter. Please try again.')
    expect(html).toContain('Dear friend,') // the letter itself remains visible
  })
})

// Pre-migration audit correction (2026-09-14), Part 4 — "the back is
// written for this particular sending": a blank sender-written back
// must prevent Send with a restrained inline instruction, never a red
// error, and never blocking Preview itself from opening.
describe('LetterPreview — sendBlockedReason (audit correction, Part 4)', () => {
  it('disables Send and shows the restrained instruction when a reason is given', () => {
    const html = renderPreview({ sendBlockedReason: 'Write something on the back of your postcard before sending.' })
    expect(html).toContain('Write something on the back of your postcard before sending.')
    // A real HTML boolean attribute (renderToStaticMarkup emits
    // `disabled=""`), never merely the Tailwind class name
    // "disabled:opacity-50" which is always present on this button.
    expect(html).toContain('disabled=""')
  })

  it('the blocked-reason instruction is muted helper text, never styled as an error', () => {
    const html = renderPreview({ sendBlockedReason: 'Write something on the back of your postcard before sending.' })
    expect(html).not.toMatch(/text-red-600">Write something/)
  })

  it('an error takes precedence over a blocked-reason instruction if somehow both are present, never shown together', () => {
    const html = renderPreview({
      error: 'Could not send your letter. Please try again.',
      sendBlockedReason: 'Write something on the back of your postcard before sending.',
    })
    expect(html).toContain('Could not send your letter. Please try again.')
    expect(html).not.toContain('Write something on the back of your postcard before sending.')
  })

  it('Send is NOT disabled when there is no blocked reason (unaffected default behavior)', () => {
    const html = renderPreview()
    expect(html).not.toContain('disabled=""')
  })
})

// Production back-editing UX defect (2026-09-15) — the blocked-reason
// text alone left the sender with no actionable path back into the
// existing, already-working Postcard editor (confirmed via a real
// production Preview: passive prose, no textarea, clicking it did
// nothing). A "Write on postcard" control must accompany it, and the
// Postcard thumbnail itself must also route straight to the same editor
// while drafting.
describe('LetterPreview — production back-editing UX defect: an actionable path into the editor', () => {
  it('renders a "Write on postcard" control alongside the blocked-reason text when onEditPostcard is given', () => {
    const html = renderPreview({
      sendBlockedReason: 'Write something on the back of your postcard before sending.',
      onEditPostcard: () => {},
    })
    expect(html).toMatch(/<button[^>]*>Write on postcard<\/button>/)
  })

  it('the control calls onEditPostcard directly — no wrapper logic in between', () => {
    expect(source).toContain('onClick={onEditPostcard}')
  })

  it('never renders the control when no onEditPostcard is supplied — the passive text alone never breaks for a caller that omits it', () => {
    const html = renderPreview({
      sendBlockedReason: 'Write something on the back of your postcard before sending.',
    })
    expect(html).toContain('Write something on the back of your postcard before sending.')
    expect(html).not.toContain('Write on postcard')
  })

  it('forwards onEditPostcard to LetterheadPostcard as onEditRequest, so the thumbnail itself is also a way in', () => {
    expect(source).toContain('onEditRequest={onEditPostcard}')
  })

  it('the postcard thumbnail, when onEditPostcard is given, routes to the editor rather than opening its own read-only overlay', () => {
    const html = renderPreview({
      postcard: { postcardKey: 'bangkokAfterRain', revealLine: '', backMessage: '' },
      onEditPostcard: () => {},
    })
    expect(html).toContain('aria-label="Edit this postcard"')
    expect(html).not.toContain('aria-label="Open postcard"')
  })
})

// R. Sender Preview must never consume/persist the recipient's
// first-reveal state — there is no persistence mechanism anywhere in
// this codebase yet (a future checkpoint's responsibility), and Preview
// specifically introduces none either.
describe('LetterPreview — R. no recipient first-reveal persistence', () => {
  it('LetterPreview never passes a hasRevealedBefore prop through to MomentDisplay/PostcardObject — it lets the same defaulting-to-false behavior apply as any other open', () => {
    expect(source).not.toContain('hasRevealedBefore')
  })

  it('LetterPreview has no database write of any kind', () => {
    expect(source).not.toContain('.insert(')
    expect(source).not.toContain('.update(')
    expect(source).not.toContain('.upsert(')
  })
})

// J. Not a "developer editor preview mode" — no debug/JSON/mode labels.
describe('LetterPreview — restrained "Preview" label only, no developer-looking UI', () => {
  it('never renders PREVIEW MODE, DEBUG, or DRAFT JSON style labels', () => {
    const html = renderPreview()
    expect(html).not.toMatch(/PREVIEW MODE/i)
    expect(html).not.toMatch(/\bDEBUG\b/i)
    expect(html).not.toMatch(/DRAFT JSON/i)
  })

  it('carries exactly one small "Preview" context label', () => {
    const html = renderPreview()
    expect((html.match(/>Preview</g) ?? []).length).toBe(1)
  })
})
