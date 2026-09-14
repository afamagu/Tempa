import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import FullAnnouncement from './full-announcement'
import type { ActiveAnnouncement } from '@/lib/announcements'
import type { AnnouncementDocJSON } from '@/lib/announcement-editor-doc'

const SECOND_PARAGRAPH_MARKER = 'SECOND_PARAGRAPH_MARKER — must appear in full here, unlike the Home teaser.'

const DOC: AnnouncementDocJSON = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph of the full Announcement.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: SECOND_PARAGRAPH_MARKER }] },
  ],
}

function announcement(overrides: Partial<ActiveAnnouncement> = {}): ActiveAnnouncement {
  return {
    id: 'ann-1',
    title: 'TEMPA Kids',
    subtitle: 'A safer, slower place to write, wonder and make friends.',
    body: 'First paragraph of the full Announcement.',
    contentJson: DOC,
    heroImagePath: 'hero.jpg',
    ...overrides,
  }
}

// Release Polish Pass — the dedicated full-article route renders the
// COMPLETE editorial body (through the same, unmodified AnnouncementBody
// component Home used to render directly) — every paragraph, unclamped.
describe('FullAnnouncement — the complete editorial article, unclamped', () => {
  it('renders every paragraph of the structured body, not just the first', () => {
    const html = renderToStaticMarkup(<FullAnnouncement announcement={announcement()} imageUrl={null} />)
    expect(html).toContain('First paragraph of the full Announcement.')
    expect(html).toContain(SECOND_PARAGRAPH_MARKER)
  })

  it('never clamps the body — no line-clamp utility anywhere', () => {
    const html = renderToStaticMarkup(<FullAnnouncement announcement={announcement()} imageUrl={null} />)
    expect(html).not.toContain('line-clamp')
  })

  it('shows title and subtitle as a real page heading, not the teaser\'s smaller h2', () => {
    const html = renderToStaticMarkup(<FullAnnouncement announcement={announcement()} imageUrl={null} />)
    expect(html).toMatch(/<h1[^>]*>TEMPA Kids<\/h1>/)
    expect(html).toContain('A safer, slower place to write, wonder and make friends.')
  })

  it('renders the hero image at full width when a resolved URL is supplied', () => {
    const html = renderToStaticMarkup(<FullAnnouncement announcement={announcement()} imageUrl="https://example.com/hero.jpg" />)
    expect(html).toContain('src="https://example.com/hero.jpg"')
  })

  it('carries no eyebrow/teaser-only chrome — no "Read announcement" CTA on the article itself', () => {
    const html = renderToStaticMarkup(<FullAnnouncement announcement={announcement()} imageUrl={null} />)
    expect(html).not.toContain('Read announcement')
  })
})
