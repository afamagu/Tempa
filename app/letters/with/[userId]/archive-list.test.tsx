import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ArchiveList from './archive-list'
import type { ArchiveLetter } from '@/lib/letters'

function letter(overrides: Partial<ArchiveLetter> = {}): ArchiveLetter {
  return {
    id: 'letter-1',
    senderId: 'user-a',
    recipientId: 'user-b',
    questionAnswerId: null,
    replyToId: null,
    correspondenceId: 'corr-1',
    body: 'A short letter excerpt for the archive card.',
    status: 'sent',
    createdAt: '2026-09-07T12:00:00Z',
    expiresAt: '2026-09-14T12:00:00Z',
    isUnread: false,
    repliedAt: null,
    closedAt: null,
    closedBy: null,
    closeReason: null,
    momentCounts: { photo: 0, postcard: 0 },
    hasLetterPostcard: false,
    ...overrides,
  }
}

// Board usability visual follow-up (2026-09-09): the archive card's own
// excerpt sits on the same bg-surface-shell authored-paper surface used
// everywhere else a member's writing is previewed — one of the genuine
// gaps this sweep found and closed.
describe('ArchiveList — chronological row archive', () => {
  it('renders each letter as a compact row with a selectable control', () => {
    const html = renderToStaticMarkup(
      <ArchiveList
        letters={[letter()]}
        viewerId="user-b"
        otherUserId="user-a"
        otherPseudonym="Evening Quill"
        viewerPseudonym="You"
      />
    )
    expect(html).toContain('Select all letters')
    expect(html).toContain('Select letter from Evening Quill')
    expect(html).toContain('A short letter excerpt')
    expect(html).not.toContain('aspect-[3/4]')
  })

  it('still shows the sender label and date outside the paper surface', () => {
    const html = renderToStaticMarkup(
      <ArchiveList
        letters={[letter()]}
        viewerId="user-b"
        otherUserId="user-a"
        otherPseudonym="Evening Quill"
        viewerPseudonym="You"
      />
    )
    expect(html).toContain('Evening Quill')
  })
})

// Letterbox Postcard indicator (pre-beta UX polish batch 1) — a distinct
// icon for letter.hasLetterPostcard, shown alongside (never instead of)
// the existing photo indicator, using the NEW letter-level Postcard flag
// rather than the old momentCounts.postcard (historical inline Moment
// Postcards).
describe('ArchiveList — Postcard indicator', () => {
  function renderCard(overrides: Partial<ArchiveLetter> = {}) {
    return renderToStaticMarkup(
      <ArchiveList
        letters={[letter(overrides)]}
        viewerId="user-b"
        otherUserId="user-a"
        otherPseudonym="Evening Quill"
        viewerPseudonym="You"
      />
    )
  }

  it('shows neither indicator for a plain text letter', () => {
    const html = renderCard()
    expect(html).not.toContain('Contains photos')
    expect(html).not.toContain('Contains a Postcard')
  })

  it('shows only the Postcard indicator when hasLetterPostcard is true and there is no photo', () => {
    const html = renderCard({ hasLetterPostcard: true })
    expect(html).toContain('Contains a Postcard')
    expect(html).not.toContain('Contains photos')
  })

  it('shows only the photo indicator when only a Photo Moment is present', () => {
    const html = renderCard({ momentCounts: { photo: 1, postcard: 0 } })
    expect(html).toContain('Contains photos')
    expect(html).not.toContain('Contains a Postcard')
  })

  it('shows both indicators together when a letter has a photo and a letter-level Postcard', () => {
    const html = renderCard({ momentCounts: { photo: 1, postcard: 0 }, hasLetterPostcard: true })
    expect(html).toContain('Contains photos')
    expect(html).toContain('Contains a Postcard')
  })

  it('never treats the OLD momentCounts.postcard (historical inline Moment Postcards) as the new letter-level Postcard', () => {
    const html = renderCard({ momentCounts: { photo: 0, postcard: 3 }, hasLetterPostcard: false })
    expect(html).not.toContain('Contains a Postcard')
  })
})
