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
  it('offers Report on another member\'s visible (non-deleted) Reply', () => {
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ authorId: 'someone-else' })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).toContain('Report')
  })

  // Production polish — own-Reply Report action: reuses the same isOwn
  // knowledge already computed for the Remove affordance, no new DB work.
  it('never offers Report on the viewer\'s OWN Reply', () => {
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ authorId: 'viewer-1' })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).not.toContain('>Report<')
  })

  it('reports with targetType "reply", not a repurposed existing target type', () => {
    expect(source).toContain('targetType="reply"')
  })

  it('the Report control is gated on the SAME isOwn flag Remove already uses — no new DB/authorId lookup', () => {
    expect(source).toContain('{!isOwn && (')
    expect(source).toContain('const isOwn = reply.authorId === viewerId')
  })
})

// ============================================================
// Production polish — long-Reply collapse. renderToStaticMarkup has no
// real layout engine (scrollHeight/clientHeight are always 0), so the
// "chevron appears once content actually overflows two lines" case
// can't be exercised via simulated DOM the way this codebase tests
// every other click-driven interactive state — proven by source
// inspection instead, alongside what IS verifiable via a real render.
// ============================================================
describe('ReplyRow — long-Reply collapse (display-only, chevron-driven)', () => {
  it('the body is clamped to 2 lines by default via line-clamp-2, collapsed on initial render', () => {
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ body: 'a'.repeat(400) })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).toContain('line-clamp-2')
  })

  it('renders the full, untouched body text — display-only clamping, never a truncated/different stored string', () => {
    const longBody = 'This reply keeps going. '.repeat(20).trim()
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ body: longBody })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).toContain(longBody.slice(0, 40))
    expect(html).not.toContain('…')
    expect(html).not.toContain('...')
  })

  it('no chevron control renders before overflow has actually been measured (short Replies show no chevron)', () => {
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ body: 'A short reply.' })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).not.toContain('aria-expanded')
  })

  it('a tombstoned Reply never gets the clamp/chevron control at all', () => {
    const html = renderToStaticMarkup(
      <ReplyRow reply={makeReply({ isDeleted: true, body: '' })} viewerId="viewer-1" dispatchId="dispatch-1" />
    )
    expect(html).not.toContain('line-clamp-2')
    expect(html).not.toContain('aria-expanded')
  })

  it('measures real DOM overflow (scrollHeight vs clientHeight) rather than a character-count heuristic, so it re-measures correctly across responsive/mobile widths', () => {
    expect(source).toContain('el.scrollHeight > el.clientHeight')
    expect(source).toContain("window.addEventListener('resize', measure)")
  })

  it('the chevron button is a real accessible control with aria-expanded and a descriptive aria-label — never "Read more" visible text, a modal, or a box', () => {
    expect(source).toContain('aria-expanded={bodyExpanded}')
    expect(source).toContain('aria-label={bodyExpanded ?')
    // Comment-stripped: the file's own doc comment explains this
    // absence using the phrase "Read more" as prose, in quotes.
    const executableSource = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
      .join('\n')
    expect(executableSource).not.toContain('Read more')
    // The button's own rendered child is the chevron icon component
    // only — no bare visible text node (the descriptive copy lives in
    // aria-label for assistive tech, never as on-screen text).
    const buttonStart = source.indexOf('aria-label={bodyExpanded')
    const buttonEnd = source.indexOf('</button>', buttonStart)
    const buttonChildren = source.slice(source.indexOf('>', buttonStart) + 1, buttonEnd).trim()
    expect(buttonChildren.startsWith('<ChevronIcon')).toBe(true)
  })

  it('clicking the chevron expands the body IN PLACE — the same <p ref={bodyRef}> element, just unclamped, never a separate/duplicated body node', () => {
    const bodyElementCount = (source.match(/whitespace-pre-wrap text-\[15px\] leading-relaxed text-foreground/g) ?? []).length
    expect(bodyElementCount).toBe(1)
    expect(source).toContain('setBodyExpanded((v) => !v)')
  })

  it('remeasurement is skipped while expanded, so the collapse-back chevron stays visible instead of disappearing once unclamped', () => {
    const start = source.indexOf('function measure()')
    const end = source.indexOf('}', start)
    const measureBody = source.slice(start, end)
    expect(measureBody).toContain('if (!el || bodyExpanded) return')
  })

  it('nested @Pseudonym still renders normally above a clamped body, and the one-level nesting wrapper is preserved', () => {
    const html = renderToStaticMarkup(
      <ReplyRow
        reply={makeReply({
          rootReplyId: 'root-1',
          replyToUserId: 'author-0',
          replyToPseudonym: 'Steady Harbor',
          body: 'a'.repeat(400),
        })}
        viewerId="viewer-1"
        dispatchId="dispatch-1"
      />
    )
    expect(html).toContain('@Steady Harbor')
    expect(html).toContain('ml-6')
    expect(html.indexOf('@Steady Harbor')).toBeLessThan(html.indexOf('line-clamp-2'))
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
