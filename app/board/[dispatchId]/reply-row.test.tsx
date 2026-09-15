import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import ReplyRow from './reply-row'
import type { Reply } from '@/lib/replies'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

const SOURCE_PATH = path.join(__dirname, 'reply-row.tsx')
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

describe('ReplyRow — one visual indentation level, never staircased', () => {
  it('a top-level Reply (rootReplyId null) renders with no indentation class', () => {
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ rootReplyId: null })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).not.toContain('ml-6')
  })

  it('a direct Reply-to-Reply (one hop) renders with exactly one indentation class', () => {
    const html = renderToStaticMarkup(
      <ReplyRow
        reply={makeReply({ id: 'reply-b', parentReplyId: 'reply-a', rootReplyId: 'reply-a' })}
        viewerId="viewer-1"
        dispatchId="dispatch-1"
      />
    )
    expect(html).toContain('ml-6')
  })

  it('a reply-to-reply-to-reply (three hops deep) renders with the SAME single indentation class, never a deeper one', () => {
    // D replies to C, C replies to B, B replies to A — parentReplyId is
    // the true 3-hop-deep chain, but rootReplyId (single-hop, computed
    // once at INSERT) always points straight at the top-level thread A.
    const html = renderToStaticMarkup(
      <ReplyRow
        reply={makeReply({ id: 'reply-d', parentReplyId: 'reply-c', rootReplyId: 'reply-a' })}
        viewerId="viewer-1"
        dispatchId="dispatch-1"
      />
    )
    expect(html).toContain('ml-6')
    expect(html).not.toContain('ml-12')
    expect(html).not.toContain('ml-24')
  })

  it('indentation is driven purely by rootReplyId !== null — a single boolean, not a numeric depth', () => {
    expect(source).toContain('reply.rootReplyId !== null')
    expect(source).not.toMatch(/ml-\$\{/)
    expect(source).not.toMatch(/depth\s*\*/)
  })
})

describe('ReplyRow — @Pseudonym target display', () => {
  it('shows "@Pseudonym" when replyToUserId and replyToPseudonym are both resolved', () => {
    const html = renderToStaticMarkup(
      <ReplyRow
        reply={makeReply({ replyToUserId: 'author-0', replyToPseudonym: 'Steady Harbor' })}
        viewerId="viewer-1"
        dispatchId="dispatch-1"
      />
    )
    expect(html).toContain('@Steady Harbor')
  })

  it('quietly omits the @ line when replyToUserId is set but replyToPseudonym could not be resolved (e.g. a full block)', () => {
    const html = renderToStaticMarkup(
      <ReplyRow
        reply={makeReply({ replyToUserId: 'author-0', replyToPseudonym: null })}
        viewerId="viewer-1"
        dispatchId="dispatch-1"
      />
    )
    expect(html).not.toContain('@')
  })

  it('omits the @ line entirely for a top-level Reply', () => {
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ replyToUserId: null, replyToPseudonym: null })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).not.toContain('@')
  })
})

describe('ReplyRow — tombstone (member-deleted) state', () => {
  it('shows the exact required "Reply removed" copy, never the (empty) body', () => {
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ isDeleted: true, body: '' })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).toContain('Reply removed')
  })

  it('hides Reply/Report/Remove affordances on a tombstoned Reply — no engagement CTA', () => {
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ isDeleted: true, body: '', authorId: 'viewer-1' })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).not.toContain('>Reply<')
    expect(html).not.toContain('>Report<')
    expect(html).not.toContain('>Remove<')
  })

  it('still preserves identity + timestamp on a tombstoned Reply', () => {
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ isDeleted: true, body: '', authorPseudonym: 'Quiet Willow' })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).toContain('Quiet Willow')
  })
})

describe('ReplyRow — own-Reply delete affordance', () => {
  it('shows "Remove" only on the viewer\'s own, non-deleted Reply', () => {
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ authorId: 'viewer-1' })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).toContain('Remove')
  })

  it('never shows "Remove" on another member\'s Reply', () => {
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ authorId: 'someone-else' })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).not.toContain('>Remove<')
  })

  it('the delete action calls deleteReply, never a hard-delete/destructive table call from the client', () => {
    expect(source).toContain('deleteReply(createClient(), reply.id)')
  })
})

describe('ReplyRow — Report affordance', () => {
  it('always offers Report on a visible (non-deleted) Reply, including the viewer\'s own', () => {
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ authorId: 'viewer-1' })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).toContain('Report')
  })

  it('reports with targetType "reply", not a repurposed existing target type', () => {
    expect(source).toContain('targetType="reply"')
  })
})

describe('ReplyRow — no popularity/engagement UI anywhere', () => {
  it('never renders a like, heart, vote, or score control on a Reply', () => {
    const lower = source.toLowerCase()
    expect(lower).not.toContain('like')
    expect(lower).not.toContain('heart')
    expect(lower).not.toContain('vote')
    expect(lower).not.toContain('score')
  })

  it('there is no Block control rendered per-Reply — Block stays profile-level only', () => {
    expect(source).not.toContain('BlockButton')
    expect(source).not.toContain("from '@/app/block-button'")
  })
})
