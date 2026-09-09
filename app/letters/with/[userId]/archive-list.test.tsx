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
    ...overrides,
  }
}

// Board usability visual follow-up (2026-09-09): the archive card's own
// excerpt sits on the same bg-surface-shell authored-paper surface used
// everywhere else a member's writing is previewed — one of the genuine
// gaps this sweep found and closed.
describe('ArchiveList — excerpt sits on the shared authored-paper surface', () => {
  it('wraps the excerpt in bg-surface-shell', () => {
    const html = renderToStaticMarkup(
      <ArchiveList
        letters={[letter()]}
        viewerId="user-b"
        otherUserId="user-a"
        otherPseudonym="Evening Quill"
        viewerPseudonym="You"
      />
    )
    expect(html).toMatch(/class="[^"]*bg-surface-shell[^"]*"[^>]*>[\s\S]*A short letter excerpt/)
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
