import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AnnouncementTeaser from './announcement-teaser'
import type { ActiveAnnouncement } from '@/lib/announcements'
import type { AnnouncementDocJSON } from '@/lib/announcement-editor-doc'

const LONG_PARAGRAPH =
  'This is the first paragraph of a fairly long Announcement body, long enough to span several lines ' +
  'once rendered at full width, which is exactly the case this teaser exists to compress.'
const SECOND_PARAGRAPH_MARKER = 'SECOND_PARAGRAPH_MARKER — must never appear on the Home teaser.'

const DOC: AnnouncementDocJSON = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: LONG_PARAGRAPH }] },
    { type: 'paragraph', content: [{ type: 'text', text: SECOND_PARAGRAPH_MARKER }] },
  ],
}

function announcement(overrides: Partial<ActiveAnnouncement> = {}): ActiveAnnouncement {
  return {
    id: 'ann-1',
    title: 'TEMPA Kids',
    subtitle: 'A safer, slower place to write, wonder and make friends.',
    body: LONG_PARAGRAPH,
    contentJson: DOC,
    heroImagePath: 'hero.jpg',
    ...overrides,
  }
}

// Release Polish Pass — Home must show a compact editorial TEASER,
// never the full Announcement body (the bug this component fixes).
describe('AnnouncementTeaser — a teaser, never the full article', () => {
  it('shows the eyebrow, title, and subtitle', () => {
    const html = renderToStaticMarkup(<AnnouncementTeaser announcement={announcement()} imageUrl="https://example.com/hero.jpg" />)
    expect(html).toContain('Announcement')
    expect(html).toContain('TEMPA Kids')
    expect(html).toContain('A safer, slower place to write, wonder and make friends.')
  })

  it('renders the hero image when a resolved URL is supplied', () => {
    const html = renderToStaticMarkup(<AnnouncementTeaser announcement={announcement()} imageUrl="https://example.com/hero.jpg" />)
    expect(html).toContain('src="https://example.com/hero.jpg"')
  })

  it('renders no image at all when none resolved, rather than a broken/placeholder image', () => {
    const html = renderToStaticMarkup(<AnnouncementTeaser announcement={announcement()} imageUrl={null} />)
    expect(html).not.toContain('<img')
  })

  it('shows only the first paragraph, clamped — never the full multi-paragraph body', () => {
    const html = renderToStaticMarkup(<AnnouncementTeaser announcement={announcement()} imageUrl={null} />)
    expect(html).toContain('line-clamp-2')
    expect(html).toContain('This is the first paragraph')
    expect(html).not.toContain(SECOND_PARAGRAPH_MARKER)
  })

  it('links "Read announcement" to the dedicated full-article route', () => {
    const html = renderToStaticMarkup(<AnnouncementTeaser announcement={announcement()} imageUrl={null} />)
    expect(html).toMatch(/href="\/announcement"[^>]*>[\s\S]*Read announcement/)
  })

  it('the hero image itself also links to the full article', () => {
    const html = renderToStaticMarkup(<AnnouncementTeaser announcement={announcement()} imageUrl="https://example.com/hero.jpg" />)
    // React 19 hoists a <link rel="preload" as="image"> ahead of the
    // returned markup for this <img>, so this anchors on the actual
    // href/img ORDER rather than an exact adjacent-string match.
    const hrefIndex = html.indexOf('href="/announcement"')
    const imgIndex = html.indexOf('<img', hrefIndex)
    const readIndex = html.indexOf('Read announcement')
    expect(hrefIndex).toBeGreaterThan(-1)
    expect(imgIndex).toBeGreaterThan(hrefIndex)
    expect(imgIndex).toBeLessThan(readIndex)
  })

  it('falls back to the plain-text body when no structured contentJson exists', () => {
    const html = renderToStaticMarkup(
      <AnnouncementTeaser announcement={announcement({ contentJson: null, body: 'Plain fallback body text.' })} imageUrl={null} />
    )
    expect(html).toContain('Plain fallback body text.')
  })

  it('renders no subtitle element when the Announcement has none', () => {
    const html = renderToStaticMarkup(<AnnouncementTeaser announcement={announcement({ subtitle: null })} imageUrl={null} />)
    expect(html).not.toContain('italic')
  })
})
