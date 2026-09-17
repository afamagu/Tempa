import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import MomentsComposer from './moments-composer'

const SOURCE_PATH = path.join(__dirname, 'moments-composer.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

function renderComposer(overrides: Partial<Parameters<typeof MomentsComposer>[0]> = {}) {
  return renderToStaticMarkup(
    <MomentsComposer
      correspondenceId="corr-1"
      momentsQualified
      canSendPhoto
      isFirstPhotoRequest={false}
      photoDecisionOutstandingForMe={false}
      recipientPseudonym="Evening Quill"
      senderPseudonym="Morning Larch"
      cancelHref="/letters/with/recipient-1"
      {...overrides}
    />
  )
}

// Send-button reactivity audit (2026-09-05) — MomentsComposer shared
// the exact same missing shouldRerenderOnTransaction as first-letter-
// composer.tsx. The actual eligibility logic is covered exhaustively
// by lib/letter-editor-doc.test.ts's canSendLetter suite (this
// composer now calls that same canonical helper, layering its own
// !uploadingIndex/!pendingFirstPhoto photo-flow gates on top); this is
// a narrower smoke test confirming the composer itself renders safely
// and starts with Send correctly disabled before the Tiptap editor
// instance exists (immediatelyRender: false is specifically for this
// — exercising live typing/photo-attachment needs a DOM this project's
// Vitest environment deliberately doesn't provide).
describe('MomentsComposer — initial render (editor not yet mounted)', () => {
  // WRITE → PREVIEW → SEND (2026-09-08): the composer's own primary/
  // final action is now "Preview letter" — Send itself only ever lives
  // inside LetterPreview (opened from Preview letter), never as a
  // direct composer action. See the Preview-specific describe block
  // below for that.
  it('renders without crashing and starts with Preview letter disabled', () => {
    const html = renderComposer()
    expect(html).toContain('Preview letter')
    expect(html).not.toContain('>Send letter<')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Preview letter<\/button>/)
  })

  it('shows the Moments-unavailable notice when momentsQualified is false, and does not crash', () => {
    const html = renderComposer({ momentsQualified: false })
    expect(html).toContain('available in this correspondence yet.')
    // Visual Language Pass 1B — this passive, no-action notice now
    // renders through the shared TempaNote primitive.
    expect(html).toContain('Tempa Note')
  })

  it('shows the photo-unavailable notice via TempaNote when qualified but not currently sendable', () => {
    const html = renderComposer({ canSendPhoto: false, photoDecisionOutstandingForMe: false })
    expect(html).toContain('available in this correspondence right now.')
    expect(html).toContain('Tempa Note')
  })

  it('shows the photo-decision-outstanding notice when applicable, NOT through TempaNote (it carries a Review photo action)', () => {
    const html = renderComposer({ canSendPhoto: false, photoDecisionOutstandingForMe: true })
    expect(html).toContain('A photo is waiting for your decision')
    expect(html).not.toContain('Tempa Note')
  })

  // Regression coverage (2026-09-05 live-test report): an established-
  // but-not-yet-Moments-qualified correspondence must still let its
  // participants send a plain letter. canSend (moments-composer.tsx)
  // never references momentsQualified at all — only content/aboveMax/
  // submitting/uploadingIndex/pendingFirstPhoto — so Send's disabled
  // state must be identical regardless of momentsQualified, while the
  // Moments-availability notice text is the only thing that changes.
  it('momentsQualified never changes whether Preview letter is disabled — only the Moments-availability notice', () => {
    const qualified = renderComposer({ momentsQualified: true })
    const notQualified = renderComposer({ momentsQualified: false })

    const previewButton = /<button[^>]*>(?:(?!<\/button>).)*Preview letter[\s\S]*?<\/button>/
    const qualifiedButton = qualified.match(previewButton)?.[0] ?? ''
    const notQualifiedButton = notQualified.match(previewButton)?.[0] ?? ''

    expect(qualifiedButton).toContain('disabled')
    expect(notQualifiedButton).toContain('disabled')
    expect(qualifiedButton.includes('disabled')).toBe(notQualifiedButton.includes('disabled'))

    expect(notQualified).toContain('available in this correspondence yet.')
    expect(qualified).not.toContain('available in this correspondence yet.')
  })

  // Length-policy audit (2026-09-05 live-test report): TEMPA has no
  // product-level maximum length once a correspondence is established
  // — MAX_CHARS/charCount/aboveMax were removed from this composer
  // entirely, not merely hidden, so there is no fake limit or
  // over-limit state to display here even though none is enforced.
  it('never shows a character-count or over-the-limit indicator', () => {
    const html = renderComposer()
    expect(html).not.toMatch(/\/\s*4,?000/)
    expect(html).not.toMatch(/\/\s*2,?000/)
  })
})

// WRITE → PREVIEW → SEND (2026-09-08) — I/J/P/Q. Preview letter is the
// composer's only forward action; LetterPreview is not rendered until
// opened (never eagerly mounted); Send inside Preview reuses the exact
// existing handleSend, never a second implementation.
describe('MomentsComposer — Preview wiring (I/J/P/Q)', () => {
  it('I. exposes "Preview letter" as the primary composer action', () => {
    const html = renderComposer()
    expect(html).toContain('Preview letter')
  })

  it('J. the ordinary primary path never sends directly — Preview letter opens the (async) preparation flow, it is never wired to handleSend', () => {
    expect(source).toContain('onClick={handleOpenPreview}')
    expect(source).not.toContain('onClick={handleSend}')
  })

  // Live-repair checkpoint (2026-09-08), Part D: Preview must never open
  // text-only while a restored draft's Photos are still being resolved —
  // handleOpenPreview only ever sets previewMoments once resolution
  // finishes, and the button itself reflects that in-flight state.
  it('Preview letter is prevented from opening again while resolution is in flight, and its label reflects that', () => {
    expect(source).toContain('disabled={!canSend || preparingPreview}')
    expect(source).toContain("preparingPreview ? 'Preparing…' : 'Preview letter'")
  })

  it('LetterPreview is not present in the initial render — it only mounts once previewOpen is true', () => {
    const html = renderComposer()
    expect(html).not.toContain('Back to letter')
    expect(html).not.toContain('aria-label="Close preview"')
  })

  it('P/Q. LetterPreview is wired with onSend={handleSend} — the exact same function the composer itself defines, never a duplicate', () => {
    expect(source).toContain('onSend={handleSend}')
  })

  it('LetterPreview receives the live sending/error state, never its own separate copies', () => {
    expect(source).toContain('sending={sending}')
    expect(source).toContain('error={error}')
  })

  // Live-repair checkpoint (2026-09-08), Part B/D: Preview resolves
  // restored Photos through the ONE canonical resolver — never the old,
  // previewUrl-trusting docToPreviewMoments, and never a second signing
  // implementation of its own.
  it('resolves Preview Moments via the canonical descriptor + resolver pipeline, never the old previewUrl-trusting adapter', () => {
    expect(source).toContain('docToDraftMomentDescriptors(')
    expect(source).toContain('resolveDraftPreviewMoments(')
    expect(source).toContain('resolveLetterPhotoUrl(supabase, imagePath)')
    expect(source).not.toContain('docToPreviewMoments')
  })

  it('LetterPreview only mounts once previewMoments is resolved, and closing clears it back to null', () => {
    expect(source).toContain('{previewMoments && (')
    expect(source).toContain('onClose={() => setPreviewMoments(null)}')
  })

  it('LetterPreview receives the separate letter-level Postcard draft, not folded into moments', () => {
    expect(source).toContain('postcard={postcardDraft}')
  })

  it('LetterPreview receives the real sender pseudonym for the Postcard back, never omitted', () => {
    expect(source).toContain('senderPseudonym={senderPseudonym}')
  })
})

// Pre-migration audit correction (2026-09-14), Part 4 — a blank sender-
// written back must block the actual Send action, but never block
// opening Preview itself (which is still draft-time reading).
describe('MomentsComposer — blank-back Send guard (audit correction, Part 4)', () => {
  it('computes postcardNeedsMessage from the draft\'s own trimmed backMessage', () => {
    expect(source).toContain(
      'const postcardNeedsMessage = Boolean(postcardDraft && postcardDraft.backMessage.trim().length === 0)'
    )
  })

  it('handleSend refuses to proceed while postcardNeedsMessage is true', () => {
    expect(source).toContain('if (!editor || !canSend || postcardNeedsMessage) return')
  })

  it('postcardNeedsMessage is NOT folded into canSend — Preview letter itself stays unaffected by a blank back', () => {
    const canSendStart = source.indexOf('const canSend =')
    const canSendEnd = source.indexOf('const postcardNeedsMessage')
    const canSendBody = source.slice(canSendStart, canSendEnd)
    expect(canSendBody).not.toContain('postcardNeedsMessage')
  })

  it('passes a restrained instruction, not a raw boolean, through to LetterPreview\'s own sendBlockedReason prop', () => {
    expect(source).toContain('sendBlockedReason={')
    expect(source).toContain('Write something on the back of your postcard before sending.')
  })
})

// Production back-editing UX defect (2026-09-15) — a real production
// Preview test found the blank-back warning was passive prose with no
// way back into the already-working Postcard editor. Preview now gets
// an onEditPostcard callback that reopens the SAME PostcardEditor
// (never a second implementation), and the editor is told to start
// already turned over ONLY when reached this way.
describe('MomentsComposer — production back-editing UX defect: an actionable path back into the editor from Preview', () => {
  it('passes onEditPostcard to LetterPreview, reusing the existing setPostcardEditorOpen mechanism', () => {
    expect(source).toContain('onEditPostcard={() => {')
  })

  it('marks postcardEditorStartOnBack true only on the Preview-triggered path', () => {
    const previewCallbackStart = source.indexOf('onEditPostcard={() => {')
    const previewCallbackBody = source.slice(previewCallbackStart, source.indexOf('}}', previewCallbackStart))
    expect(previewCallbackBody).toContain('setPostcardEditorStartOnBack(true)')
    expect(previewCallbackBody).toContain('setPostcardEditorOpen(true)')
  })

  it('resets postcardEditorStartOnBack to false for the ordinary composer-slot edit path, so that path keeps opening on the front', () => {
    const slotEditStart = source.indexOf("onEdit={() => {")
    const slotEditBody = source.slice(slotEditStart, source.indexOf('}}', slotEditStart))
    expect(slotEditBody).toContain('setPostcardEditorStartOnBack(false)')
  })

  it('forwards postcardEditorStartOnBack to PostcardEditor as startOnBack', () => {
    expect(source).toContain('startOnBack={postcardEditorStartOnBack}')
  })
})

// Pre-migration audit correction (2026-09-14), Part 2 — NEW POSTCARDS
// ARE NOT MOMENTS: a legacy inline postcardMoment found in a restored
// draft is migrated into the new separate draft on restore, and never
// left in the document to be resubmitted as a Moment.
describe('MomentsComposer — legacy postcardMoment migration on restore (audit correction, Part 2)', () => {
  it('detects a legacy postcardMoment via extractLegacyPostcardMoment before restoring the doc', () => {
    expect(source).toContain('extractLegacyPostcardMoment(richDraft)')
  })

  it('strips it from the document before setContent, so it can never be resubmitted as a Moment', () => {
    expect(source).toContain('editor.commands.setContent(stripPostcardMoments(richDraft))')
  })

  it('never overwrites an already-chosen separate Postcard draft — the migration uses a functional updater that checks current state', () => {
    expect(source).toContain('setPostcardDraft((current) => {')
    expect(source).toContain('if (current) return current')
  })

  it('the migrated draft starts with a blank back message, which the blank-back Send guard above will correctly catch', () => {
    const migrateStart = source.indexOf('const migrated: LetterPostcardDraft = {')
    const migrateEnd = source.indexOf('writeLetterPostcardDraft(correspondenceId, migrated)')
    const migrateBody = source.slice(migrateStart, migrateEnd)
    expect(migrateBody).toContain("revealLine: ''")
    expect(migrateBody).toContain("backMessage: ''")
  })
})

// Letter-Level Postcards V1 (2026-09-13) — NEW POSTCARDS ARE NOT
// MOMENTS: a Postcard is now a letter-level enclosure with its own
// separate draft, never a paragraph-positioned ProseMirror node, and
// never created from the ⊕ Moments sheet anymore.
describe('MomentsComposer — Letter-Level Postcards (A/C/F)', () => {
  it('A. the empty letterhead slot renders before any editor content, independent of ProseMirror', () => {
    const html = renderComposer()
    expect(html).toContain('Add a postcard')
  })

  it('the letterhead slot is gated by momentsQualified, mirroring the ⊕ affordance\'s own gate', () => {
    const html = renderComposer({ momentsQualified: false })
    expect(html).not.toContain('Add a postcard')
  })

  it('C. the composer holds at most one Postcard draft — a single nullable object, never an array or list', () => {
    expect(source).toContain('useState<LetterPostcardDraft | null>(null)')
    expect(source).not.toMatch(/postcardDraft(s)?:\s*LetterPostcardDraft\[\]/)
  })

  it('F. "Add a postcard" no longer appears inside the ⊕ Moments picker — Photo functionality only', () => {
    // Isolated by literal string position (never a fragile regex over
    // the whole picker's JSX) — everything between the ⊕ picker's own
    // opening marker and the NEW, unrelated postcard-picker block that
    // immediately follows it in source.
    const pickerStart = source.indexOf('{openPicker !== null && (')
    const pickerEnd = source.indexOf('{postcardPickerOpen && (')
    expect(pickerStart).toBeGreaterThan(-1)
    expect(pickerEnd).toBeGreaterThan(pickerStart)
    const picker = source.slice(pickerStart, pickerEnd)
    expect(picker).not.toContain('Add a postcard')
    expect(picker).toContain('<MomentSourceMenu')
  })

  it('a NEW Postcard is never inserted into ProseMirror — no postcardMoment.create call remains in this file', () => {
    expect(source).not.toContain('schema.nodes.postcardMoment.create')
    expect(source).not.toContain('insertPostcardMomentAtParagraphEnd')
  })

  it('PostcardMoment stays registered as an editor extension, for backward compatibility with an already-restored legacy draft', () => {
    expect(source).toContain('PostcardMoment,')
  })

  it('the letter-level Postcard draft is restored and persisted through its own separate module, never the editor draft module', () => {
    expect(source).toContain('readLetterPostcardDraft(correspondenceId)')
    expect(source).toContain('writeLetterPostcardDraft(correspondenceId')
    expect(source).toContain('clearLetterPostcardDraft(correspondenceId)')
  })

  it('the send payload carries the Postcard SEPARATELY from p_moments, never folded into it', () => {
    expect(source).toContain('p_postcard: postcardPayload')
    expect(source).not.toMatch(/p_moments:\s*\[.*postcardPayload/)
  })
})

// Moment menu anchoring fix (pre-beta UX polish batch 1) — the ⊕
// picker no longer pins itself to the bottom of the composer; it opens
// spatially anchored to whichever ⊕ control was actually tapped, via
// the shared MomentSourceMenu (moment-source-menu.tsx), so a writer far
// down a long letter can't miss that it opened.
describe('MomentsComposer — Moment menu anchored to the tapped control', () => {
  it('captures the tapped ⊕\'s own bounding rect and stores it alongside the paragraph index', () => {
    expect(source).toContain('onRequestPhoto: (index, anchorRect) => setOpenPicker({ index, anchorRect })')
  })

  it('renders the picker anchored to that rect, never a fixed bottom sheet', () => {
    // Scoped to the ⊕ picker block only — the file's UNRELATED
    // postcard-picker sheet (a different, untouched feature) still
    // legitimately uses a fixed bottom sheet of its own.
    const pickerStart = source.indexOf('{openPicker !== null && (')
    const pickerEnd = source.indexOf('{postcardPickerOpen && (')
    const picker = source.slice(pickerStart, pickerEnd)
    expect(picker).toContain('anchorRect={openPicker.anchorRect}')
    expect(picker).not.toContain('fixed inset-x-0 bottom-0')
  })

  it('wires Cancel/outside-click dismissal through the shared menu\'s onCancel callback', () => {
    expect(source).toContain('onCancel={() => setOpenPicker(null)}')
  })
})

// Onboarding & First-Use checkpoint (Checkpoint 2B, Section A) — the
// Letter composer's own Postcard first-encounter, completing the
// cross-surface contract the Dispatch composer already has
// (app/board/dispatch-composer.tsx). Same shared 'postcard' guide key,
// same FeatureIntroduction component, never a second 'letter_postcard'
// key or a duplicated introduction implementation.
describe('MomentsComposer — Postcard FeatureIntroduction (cross-surface first encounter)', () => {
  // Post-onboarding corrections checkpoint (Section G) — showPostcardIntro
  // alone used to be enough to render this the instant the composer
  // mounted. It now needs a genuine slot activation too
  // (postcardIntroActive, starts false) — covered by source inspection
  // below since renderToStaticMarkup can't exercise the click.
  it('never renders on initial render, even when showPostcardIntro is true and the slot is usable — it needs a genuine slot activation first', () => {
    const html = renderComposer({ showPostcardIntro: true, momentsQualified: true })
    expect(html).not.toContain('Postcards')
    expect(html).not.toContain('Choose a postcard')
    expect(html).toContain('Add a postcard')
  })

  it('never shows it while the Postcard slot itself is not yet usable (momentsQualified false) — never globally on every composer render', () => {
    const html = renderComposer({ showPostcardIntro: true, momentsQualified: false })
    expect(html).not.toContain('Postcards')
  })

  it('the Postcard slot activation is gated on showPostcardIntro, and its CTA opens the real picker, not just a dismissal (Section G/H)', () => {
    expect(source).toContain('function handleAddPostcard() {')
    const fnStart = source.indexOf('function handleAddPostcard() {')
    const fnEnd = source.indexOf('\n  }', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)
    expect(fnBody).toContain('if (showPostcardIntro) {')
    expect(fnBody).toContain('setPostcardIntroActive(true)')
    expect(fnBody).toContain('setPostcardPickerOpen(true)')

    expect(source).toContain('onAdd={handleAddPostcard}')
    const normalized = source.replace(/\s+/g, ' ')
    expect(normalized).toContain('onCta={() => { setPostcardIntroActive(false) setPostcardPickerOpen(true) }}')
  })

  it('uses the exact same FeatureIntroduction component and guide key as the Dispatch composer — never a duplicated implementation or a second key', () => {
    expect(source).toContain("import FeatureIntroduction from '@/app/feature-introduction'")
    expect(source).toContain('guideKey="postcard"')
    expect(source).not.toContain('letter_postcard')
    expect(source).not.toMatch(/function\s+FeatureIntroduction/)
  })

  it('is positioned before the Postcard slot itself, at the point of first encountering it', () => {
    const introIndex = source.indexOf('guideKey="postcard"')
    const slotIndex = source.indexOf('<PostcardComposerSlot')
    expect(introIndex).toBeGreaterThan(-1)
    expect(slotIndex).toBeGreaterThan(introIndex)
  })

  it('never alters Postcard artwork/catalogue/sending mechanics or Letter sending/correspondence mechanics — no new query, RPC, or send-path change introduced by this addition', () => {
    const introStart = source.indexOf('guideKey="postcard"')
    const introEnd = source.indexOf('<PostcardComposerSlot', introStart)
    const introBlock = source.slice(introStart, introEnd)
    expect(introBlock).not.toContain('.rpc(')
    expect(introBlock).not.toContain('write_letter')
    expect(introBlock).not.toContain('getActivePostcards')
  })
})
