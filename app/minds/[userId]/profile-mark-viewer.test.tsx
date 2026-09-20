import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ProfileMarkViewer from './profile-mark-viewer'

describe('ProfileMarkViewer', () => {
  it('makes a saved Mark explicitly openable', () => {
    const html = renderToStaticMarkup(<ProfileMarkViewer identifier="mind-1" markUrl="https://example.com/mark.png" pseudonym="Evening Quill" />)
    expect(html).toContain('aria-label="View Evening Quill’s Mark"')
    expect(html).toContain('alt="Evening Quill’s Mark"')
  })

  it('keeps the grandfathered Mindform non-interactive', () => {
    const html = renderToStaticMarkup(<ProfileMarkViewer identifier="mind-1" markUrl={null} pseudonym="Evening Quill" />)
    expect(html).not.toContain('<button')
  })
})
