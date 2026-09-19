import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DispatchPreview from './dispatch-preview'
import type { DispatchMoment } from '@/lib/dispatches'
import type { LetterPostcardDraft } from '@/lib/moments'
import type { PostcardCatalogEntry } from '@/lib/postcards'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

function catalogEntry(overrides: Partial<PostcardCatalogEntry> = {}): PostcardCatalogEntry {
  return {
    key: 'essaouira',
    title: 'Essaouira',
    countryCode: 'MA',
    location: 'Atlantic Morocco',
    collection: 'Atlantic Morocco Collection',
    postmarkText: 'ESSAOUIRA',
    footerText: 'Tempa Postcard',
    frontImagePath: '/postcards/essaouira.jpg',
    motionSrc: null,
    durationSeconds: null,
    revealLineAlignment: null,
    ...overrides,
  }
}

// Finds the <button> whose visible text contains `label` and returns
// whether it carries the literal `disabled` HTML attribute — never a
// bare substring search for "disabled", since primaryButtonClass always
// includes the static Tailwind pseudo-class utility `disabled:opacity-50`
// in its className regardless of actual button state, which would make
// a naive substring check pass even for an enabled button.
function isButtonDisabled(html: string, label: string): boolean {
  const labelIndex = html.indexOf(label)
  expect(labelIndex, `expected to find a button labeled "${label}"`).toBeGreaterThan(-1)
  const tagStart = html.lastIndexOf('<button', labelIndex)
  const tagEnd = html.indexOf('>', tagStart)
  const openTag = html.slice(tagStart, tagEnd)
  return /\bdisabled(="")?(?=[\s>])/.test(openTag)
}

function baseProps(overrides: Partial<Parameters<typeof DispatchPreview>[0]> = {}) {
  return {
    authorId: 'author-1',
    authorPseudonym: 'Evening Quill',
    title: 'A quiet morning ritual',
    body: 'First paragraph.\n\nSecond paragraph.',
    topics: ['mornings'],
    moments: [] as DispatchMoment[],
    postcardDraft: null as LetterPostcardDraft | null,
    postcardCatalogEntry: null as PostcardCatalogEntry | null,
    onBack: () => {},
    onPublish: () => {},
    publishing: false,
    ...overrides,
  }
}

// Dispatch Preview checkpoint (WRITE → PREVIEW → PUBLISH).
describe('DispatchPreview — shows the Dispatch substantially as a reader will experience it', () => {
  it('renders title, author identity/pseudonym, topics, and formatted body', () => {
    const html = renderToStaticMarkup(<DispatchPreview {...baseProps()} />)
    expect(html).toContain('A quiet morning ritual')
    expect(html).toContain('Evening Quill')
    expect(html).toContain('mornings')
    expect(html).toContain('First paragraph.')
    expect(html).toContain('Second paragraph.')
  })

  it('previews the author\'s saved Mark in its native composition', () => {
    const html = renderToStaticMarkup(
      <DispatchPreview {...baseProps({ authorMarkUrl: 'https://example.test/mark.png' })} />
    )
    expect(html).toContain('src="https://example.test/mark.png"')
    expect(html).toContain('object-contain')
    expect(html).not.toContain('object-cover')
  })

  it('renders Moments using the real reader presentation component (DispatchBody), in their actual positions', () => {
    const html = renderToStaticMarkup(
      <DispatchPreview
        {...baseProps({
          moments: [{ id: 'm-1', position: 0, imageUrl: 'https://signed.test/a.jpg' }],
        })}
      />
    )
    expect(html).toContain('https://signed.test/a.jpg')
  })

  it('renders no Moment images when there are none', () => {
    const html = renderToStaticMarkup(<DispatchPreview {...baseProps({ moments: [] })} />)
    expect(html).not.toMatch(/<img/)
  })

  it('renders no topics section when there are none', () => {
    const html = renderToStaticMarkup(<DispatchPreview {...baseProps({ topics: [] })} />)
    expect(html).not.toContain('mornings')
  })
})

describe('DispatchPreview — Postcard integrity (shown before the author commits to an immutable choice)', () => {
  it('renders the selected Postcard, its reveal line, and its back message when attached', () => {
    const html = renderToStaticMarkup(
      <DispatchPreview
        {...baseProps({
          postcardDraft: { postcardKey: 'essaouira', revealLine: 'Keep a little sea with you.', backMessage: 'Made it here at last.' },
          postcardCatalogEntry: catalogEntry(),
        })}
      />
    )
    expect(html).toContain('/postcards/essaouira.jpg')
  })

  it('renders nothing Postcard-related when no Postcard is attached', () => {
    const html = renderToStaticMarkup(<DispatchPreview {...baseProps({ postcardDraft: null, postcardCatalogEntry: null })} />)
    expect(html).not.toContain('/postcards/')
  })

  it('renders nothing Postcard-related when the draft references a key no longer in the active catalogue (catalogEntry null)', () => {
    const html = renderToStaticMarkup(
      <DispatchPreview
        {...baseProps({
          postcardDraft: { postcardKey: 'retired', revealLine: '', backMessage: 'Hello.' },
          postcardCatalogEntry: null,
        })}
      />
    )
    expect(html).not.toContain('/postcards/')
  })
})

describe('DispatchPreview — never a fake live Board page (no reader-only interaction controls)', () => {
  it('never renders Worth Reading, Replies, Read Next, moderation/report, or share controls', () => {
    const html = renderToStaticMarkup(<DispatchPreview {...baseProps()} />)
    const lower = html.toLowerCase()
    expect(lower).not.toContain('worth reading')
    expect(lower).not.toContain('reply')
    expect(lower).not.toContain('read next')
    expect(lower).not.toContain('report')
    expect(lower).not.toMatch(/\bshare\b/)
  })
})

describe('DispatchPreview — actions', () => {
  it('offers exactly "Back to editing" and "Publish Dispatch"', () => {
    const html = renderToStaticMarkup(<DispatchPreview {...baseProps()} />)
    expect(html).toContain('Back to editing')
    expect(html).toContain('Publish Dispatch')
  })

  it('disables Publish while publishing, and swaps the label', () => {
    const html = renderToStaticMarkup(<DispatchPreview {...baseProps({ publishing: true })} />)
    expect(html).toContain('Publishing…')
    expect(isButtonDisabled(html, 'Publishing…')).toBe(true)
  })

  it('never disables "Back to editing" while publishing — the author can always return', () => {
    const html = renderToStaticMarkup(<DispatchPreview {...baseProps({ publishing: true })} />)
    expect(isButtonDisabled(html, 'Back to editing')).toBe(false)
  })

  it('disables Publish and shows a restrained, understandable reason when publishBlockedReason is set — never a hard error style', () => {
    const html = renderToStaticMarkup(
      <DispatchPreview
        {...baseProps({ publishBlockedReason: 'Write something on the back of your postcard before publishing.' })}
      />
    )
    expect(html).toContain('Write something on the back of your postcard before publishing.')
    expect(isButtonDisabled(html, 'Publish Dispatch')).toBe(true)
    expect(html).not.toContain('text-red-600')
  })

  it('offers a direct "Write on postcard" link back into the Postcard editor when blocked and onEditPostcard is provided', () => {
    const html = renderToStaticMarkup(
      <DispatchPreview
        {...baseProps({
          publishBlockedReason: 'Write something on the back of your postcard before publishing.',
          onEditPostcard: () => {},
        })}
      />
    )
    expect(html).toContain('Write on postcard')
  })

  it('shows a real error (not the blocked-reason guidance styling) when publish fails, and does not also show publishBlockedReason at the same time', () => {
    const html = renderToStaticMarkup(
      <DispatchPreview
        {...baseProps({
          error: 'Could not publish your Dispatch. Please try again.',
          publishBlockedReason: 'Write something on the back of your postcard before publishing.',
        })}
      />
    )
    expect(html).toContain('Could not publish your Dispatch. Please try again.')
    expect(html).toContain('text-red-600')
    // The blocked-reason guidance line is suppressed while a hard error
    // is showing — one explanation at a time, never both stacked.
    expect(html).not.toContain('Write something on the back of your postcard before publishing.')
  })

  it('enables Publish with no blocked reason and no error', () => {
    const html = renderToStaticMarkup(<DispatchPreview {...baseProps()} />)
    expect(isButtonDisabled(html, 'Publish Dispatch')).toBe(false)
  })
})
