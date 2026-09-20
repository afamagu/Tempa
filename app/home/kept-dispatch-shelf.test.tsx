import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import KeptDispatchShelf from './kept-dispatch-shelf'
import type { BoardFeedItem } from '@/lib/dispatches'

const dispatch: BoardFeedItem = {
  id: 'dispatch-1',
  authorId: 'author-1',
  authorPseudonym: 'Evening Quill',
  authorCountry: 'South Africa',
  authorMarkUrl: 'https://example.test/mark.png',
  title: 'A sentence worth returning to',
  body: 'This body must not become another shelf excerpt.',
  publishedAt: '2026-09-20T12:00:00Z',
  moderationStatus: 'visible',
  topics: [],
  isKept: true,
  isFamiliar: true,
  cursor: { seenBucket: 0, rankKey: '1', seedHash: 1, id: 'dispatch-1' },
}

describe('KeptDispatchShelf', () => {
  it('is a compact identity-and-title index rather than another Board card', () => {
    const html = renderToStaticMarkup(
      <KeptDispatchShelf dispatches={[dispatch]} trailQueryFor={() => 's=session&seed=seed'} />
    )
    expect(html).toContain('Evening Quill')
    expect(html).toContain('South Africa')
    expect(html).toContain('A sentence worth returning to')
    expect(html).not.toContain('This body must not become another shelf excerpt.')
    expect(html).not.toMatch(/<img[^>]+dispatch/i)
    expect(html).toContain('href="/board/dispatch-1?s=session&amp;seed=seed"')
  })
})
