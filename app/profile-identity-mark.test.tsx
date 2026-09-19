import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ProfileIdentityMark from './profile-identity-mark'

describe('ProfileIdentityMark', () => {
  it('shows a saved Mark without circular clipping or cover cropping', () => {
    const html = renderToStaticMarkup(
      <ProfileIdentityMark identifier="member-1" markUrl="https://example.test/mark.png" label="Evening Quill's Mark" size="lg" />
    )
    expect(html).toContain('src="https://example.test/mark.png"')
    expect(html).toContain('object-contain')
    expect(html).not.toContain('rounded-full')
    expect(html).not.toContain('object-cover')
    expect(html).not.toContain('background-image')
  })

  it('preserves the established Mindform fallback for a legacy member', () => {
    const html = renderToStaticMarkup(
      <ProfileIdentityMark identifier="legacy-member" markUrl={null} size="sm" />
    )
    expect(html).toContain('rounded-full')
    expect(html).toContain('aria-hidden="true"')
  })
})
