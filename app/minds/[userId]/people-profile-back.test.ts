import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'people-profile-back.tsx'), 'utf8')

describe('People profile return navigation', () => {
  it('sanitizes the return destination before using it as an href', () => {
    expect(source).toContain('sanitizeInternalPath(returnTo)')
    expect(source).toContain("?? '/minds'")
  })

  it('prefers browser back when opened from People so filters and scroll position can be restored naturally', () => {
    expect(source).toContain('router.back()')
    expect(source).toContain('window.history.length > 1')
  })

  it('renders a clear back affordance', () => {
    expect(source).toContain('aria-label="Back to People"')
    expect(source).toContain('<span aria-hidden="true">←</span>')
  })
})
