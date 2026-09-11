import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AnnouncementBody from './announcement-body'
import type { AnnouncementDocJSON } from '@/lib/announcement-editor-doc'

// Final Correction round, item 6/8 — DEFENSIVE rendering: even though
// public.announcement_content_is_valid should already guarantee the
// database never contains malformed/unsafe content, the renderer must
// never trust that blindly. These docs are deliberately shaped like
// corrupted/adversarial persisted data (built with `as unknown as
// AnnouncementDocJSON` casts, since TypeScript's closed union type
// would never let real application code construct them) — proving the
// renderer's own defenses hold even if the database guarantee were
// somehow bypassed.

describe('AnnouncementBody — renderer refuses unsafe hrefs defensively (item 6)', () => {
  it('renders a safe https:// link as a real clickable anchor', () => {
    const doc: AnnouncementDocJSON = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'click here', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }],
        },
      ],
    }
    const html = renderToStaticMarkup(<AnnouncementBody doc={doc} />)
    expect(html).toContain('<a href="https://example.com"')
    expect(html).toContain('click here')
  })

  it('never renders a javascript: href as a clickable anchor, even if it somehow ended up in persisted data', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'click here', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
        },
      ],
    } as unknown as AnnouncementDocJSON
    const html = renderToStaticMarkup(<AnnouncementBody doc={doc} />)
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('javascript:')
    // The text itself still renders — just never as a link.
    expect(html).toContain('click here')
  })

  it('never renders a protocol-relative href as a clickable anchor', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'click here', marks: [{ type: 'link', attrs: { href: '//evil.example.com' } }] }],
        },
      ],
    } as unknown as AnnouncementDocJSON
    const html = renderToStaticMarkup(<AnnouncementBody doc={doc} />)
    expect(html).not.toContain('<a ')
  })
})

describe('AnnouncementBody — unknown node/mark types are never blindly coerced (item 6)', () => {
  it('an unrecognized block type renders nothing for that block, never coerced into a paragraph', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'video', src: 'evil.mp4' },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    } as unknown as AnnouncementDocJSON
    const html = renderToStaticMarkup(<AnnouncementBody doc={doc} />)
    expect(html).toContain('Before')
    expect(html).toContain('After')
    expect(html).not.toContain('evil.mp4')
    expect(html).not.toContain('video')
  })

  it('an unrecognized mark type is ignored — text still renders, never wrapped in anything unsafe', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'plain enough', marks: [{ type: 'strike' }] }],
        },
      ],
    } as unknown as AnnouncementDocJSON
    const html = renderToStaticMarkup(<AnnouncementBody doc={doc} />)
    expect(html).toContain('plain enough')
    expect(html).not.toContain('<strike')
  })
})

describe('AnnouncementBody — still renders the ordinary, valid shapes correctly', () => {
  it('renders a heading and a bullet list', () => {
    const doc: AnnouncementDocJSON = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A heading' }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
          ],
        },
      ],
    }
    const html = renderToStaticMarkup(<AnnouncementBody doc={doc} />)
    expect(html).toContain('A heading')
    expect(html).toContain('First')
    expect(html).toContain('<ul')
  })

  it('returns null for an empty/absent document', () => {
    expect(renderToStaticMarkup(<AnnouncementBody doc={null} />)).toBe('')
  })
})
