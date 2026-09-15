import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import RepliesSection from './replies-section'
import type { Reply } from '@/lib/replies'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

const SOURCE_PATH = path.join(__dirname, 'replies-section.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: 'reply-1',
    dispatchId: 'dispatch-1',
    authorId: 'author-1',
    authorPseudonym: 'Quiet Willow',
    authorCountry: null,
    body: 'Thank you for writing this.',
    parentReplyId: null,
    rootReplyId: null,
    replyToUserId: null,
    replyToPseudonym: null,
    isDeleted: false,
    createdAt: '2026-09-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('RepliesSection — heading and terminology', () => {
  it('renders the heading "Replies", never Comments/Threads/Reactions', () => {
    const html = renderToStaticMarkup(<RepliesSection dispatchId="dispatch-1" viewerId="viewer-1" initialReplies={[]} />)
    expect(html).toContain('Replies')
    expect(html.toLowerCase()).not.toContain('comment')
    expect(html.toLowerCase()).not.toContain('thread')
    expect(html.toLowerCase()).not.toContain('reaction')
  })
})

describe('RepliesSection — empty state', () => {
  it('shows the quiet "No replies yet." copy with no manipulative engagement language', () => {
    const html = renderToStaticMarkup(<RepliesSection dispatchId="dispatch-1" viewerId="viewer-1" initialReplies={[]} />)
    expect(html).toContain('No replies yet.')
  })

  it('still shows the top-level composer trigger even with zero Replies', () => {
    const html = renderToStaticMarkup(<RepliesSection dispatchId="dispatch-1" viewerId="viewer-1" initialReplies={[]} />)
    expect(html).toContain('Reply')
  })
})

describe('RepliesSection — populated list', () => {
  it('renders one ReplyRow per Reply, in the order they were already sorted in', () => {
    const html = renderToStaticMarkup(
      <RepliesSection
        dispatchId="dispatch-1"
        viewerId="viewer-1"
        initialReplies={[
          makeReply({ id: 'reply-1', authorPseudonym: 'Quiet Willow' }),
          makeReply({ id: 'reply-2', authorPseudonym: 'Steady Harbor' }),
        ]}
      />
    )
    expect(html).toContain('Quiet Willow')
    expect(html).toContain('Steady Harbor')
    expect(html.indexOf('Quiet Willow')).toBeLessThan(html.indexOf('Steady Harbor'))
  })

  it('does not render the empty-state copy once there is at least one Reply', () => {
    const html = renderToStaticMarkup(
      <RepliesSection dispatchId="dispatch-1" viewerId="viewer-1" initialReplies={[makeReply()]} />
    )
    expect(html).not.toContain('No replies yet.')
  })
})

describe('RepliesSection — no Reply count or popularity UI', () => {
  it('never renders a numeric Reply count anywhere in its own markup or source', () => {
    const html = renderToStaticMarkup(
      <RepliesSection
        dispatchId="dispatch-1"
        viewerId="viewer-1"
        initialReplies={[makeReply({ id: 'reply-1' }), makeReply({ id: 'reply-2' })]}
      />
    )
    expect(html).not.toMatch(/\b2\s*repl(y|ies)\b/i)
    expect(source.toLowerCase()).not.toContain('replies.length}')
    expect(source).not.toContain('replies.length })')
  })

  it('passes initialReplies straight through as already-ordered data — no client-side ranking/sort by popularity', () => {
    expect(source).not.toContain('.sort(')
  })
})
