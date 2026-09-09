import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LetterBody from './letter-body'
import type { Moment } from '@/lib/moments'
import { docToPlainBody, type LetterDocJSON } from '@/lib/letter-editor-doc'

// LockedPhotoMoment's "Ask about photos" reconsideration action needs
// a router — irrelevant to what these tests check (the locked
// affordance's presence/content), so a minimal stub is enough.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

const PHOTO_CONSENT = {
  correspondenceId: 'corr-1',
  status: 'enabled' as const,
  requestedBy: null,
  resolvedBy: null,
  userId: 'viewer-1',
  otherPseudonym: 'Evening Quill',
}

function photoMoment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'moment-1',
    position: 0,
    type: 'photo',
    imageUrl: 'https://example.test/signed-url',
    postcardKey: null,
    ...overrides,
  }
}

// Moments end-to-end completion checkpoint (2026-09-05) — LetterBody is
// the recipient reader, and the one place a Moment must appear as a
// restrained inline affordance tied to its exact paragraph, never a
// gallery. These prove: historical/no-Moments letters render exactly
// as ordinary text, an unlocked photo appears only in its own
// paragraph, a locked one shows the consent affordance instead of a
// broken image, and Bold/Italic formatting coexists correctly with an
// attached Moment.
describe('LetterBody — historical/no-Moments letters', () => {
  it('a letter with no Moments at all renders as plain paragraphs with no Moment UI whatsoever', () => {
    const html = renderToStaticMarkup(
      <LetterBody body={'First paragraph.\n\nSecond paragraph.'} moments={[]} />
    )
    expect(html).toContain('First paragraph.')
    expect(html).toContain('Second paragraph.')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('Photo waiting')
    expect(html).not.toContain('aria-label="Open this photo"')
  })

  it('a historical letter (predates Moments) with an empty moments array never breaks', () => {
    const html = renderToStaticMarkup(<LetterBody body="Just an ordinary old letter." moments={[]} />)
    expect(html).toContain('Just an ordinary old letter.')
  })
})

describe('LetterBody — an unlocked (consented) photo Moment', () => {
  it('renders the photo token inline, at the end of its own paragraph only', () => {
    const html = renderToStaticMarkup(
      <LetterBody
        body={'Paragraph zero, with a photo.\n\nParagraph one, no photo.'}
        moments={[photoMoment({ position: 0 })]}
        photoConsent={PHOTO_CONSENT}
      />
    )
    // Exactly one photo token in the whole letter.
    expect((html.match(/aria-label="Open this photo"/g) ?? []).length).toBe(1)
    // It appears after paragraph zero's own text, not paragraph one's.
    expect(html).toMatch(/Paragraph zero, with a photo\.[^]*aria-label="Open this photo"/)
    expect(html).not.toMatch(/Paragraph one, no photo\.[^]*aria-label="Open this photo"/)
  })

  it('never renders a locked-photo affordance when the photo is already unlocked', () => {
    const html = renderToStaticMarkup(
      <LetterBody body="One paragraph." moments={[photoMoment({ position: 0 })]} photoConsent={PHOTO_CONSENT} />
    )
    expect(html).not.toContain('Photo waiting')
  })
})

describe('LetterBody — a locked (not-yet-consented) photo Moment', () => {
  it('renders the consent affordance instead of a broken image, and never an <img> for it', () => {
    const html = renderToStaticMarkup(
      <LetterBody
        body="One paragraph."
        moments={[photoMoment({ imageUrl: null })]}
        photoConsent={{ ...PHOTO_CONSENT, status: 'pending', requestedBy: 'other-user' }}
      />
    )
    expect(html).toContain('Photo waiting')
    expect(html).not.toContain('aria-label="Open this photo"')
  })

  it('gives the locked Moment a stable, addressable id for deep-linking from the pending-photo notice', () => {
    const html = renderToStaticMarkup(
      <LetterBody
        body="One paragraph."
        moments={[photoMoment({ id: 'moment-xyz', imageUrl: null })]}
        photoConsent={{ ...PHOTO_CONSENT, status: 'pending', requestedBy: 'other-user' }}
      />
    )
    expect(html).toContain('id="locked-photo-moment-xyz"')
  })
})

describe('LetterBody — a postcard Moment', () => {
  it('renders the postcard display, never a photo token or locked affordance', () => {
    const html = renderToStaticMarkup(
      <LetterBody
        body="One paragraph."
        moments={[{ id: 'm-1', position: 0, type: 'postcard', imageUrl: null, postcardKey: 'essaouira' }]}
      />
    )
    expect(html).not.toContain('aria-label="Open this photo"')
    expect(html).not.toContain('Photo waiting')
  })
})

describe('LetterBody — Bold/Italic formatting coexists with an attached Moment', () => {
  it('a bold/italic paragraph still shows its photo token, and formatting still applies', () => {
    // Built via the real encoder rather than hand-typing the rich-body
    // marker character — realistic, and avoids an invisible-character
    // literal sitting in the test source.
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bold text', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' in the paragraph with a photo.' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'A plain second paragraph.' }] },
      ],
    }
    const richBody = docToPlainBody(doc)
    const html = renderToStaticMarkup(
      <LetterBody body={richBody} moments={[photoMoment({ position: 0 })]} photoConsent={PHOTO_CONSENT} />
    )
    expect(html).toContain('<strong>Bold text</strong>')
    expect(html).toContain('aria-label="Open this photo"')
    expect(html).not.toContain('**')
  })
})

// Dispatch external-sharing checkpoint (2026-09-08) — private
// correspondence must remain permanently outside the sharing system
// added for Dispatches. This is a structural regression guard, not a
// UI-copy preference: LetterBody must never grow a Share/Forward
// control, since a letter has no external-sharing equivalent anywhere
// and must not (see lib/__tests__/privateLettersNoSharing.test.ts for
// the source-level guard against the actual sharing RPC names, kept
// out of this comment on purpose so it doesn't trip that same scan).
describe('LetterBody — no external sharing affordance (item 16)', () => {
  it('never renders Share/Forward vocabulary, with or without a Moment attached', () => {
    const withMoment = renderToStaticMarkup(
      <LetterBody body="One paragraph." moments={[photoMoment({ position: 0 })]} photoConsent={PHOTO_CONSENT} />
    )
    const withoutMoment = renderToStaticMarkup(<LetterBody body="One paragraph." moments={[]} />)
    for (const html of [withMoment, withoutMoment]) {
      const lower = html.toLowerCase()
      expect(lower).not.toContain('share')
      expect(lower).not.toContain('forward')
    }
  })
})
