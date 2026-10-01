import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'people-profile-back.tsx'), 'utf8')

describe('People profile return navigation', () => {
  it('sanitizes the return destination before using it as an href', () => {
    expect(source).toContain('sanitizeInternalPath(returnTo)')
    expect(source).toContain("?? '/room'")
  })

  it('uses the named destination even when browser history leads to a composer', () => {
    expect(source).not.toContain('router.back()')
    expect(source).toContain('href={destination}')
  })

  it('renders a clear back affordance', () => {
    expect(source).toContain('aria-label={`Back to ${label}`}')
    expect(source).toContain("destination.startsWith('/letters/discover')")
    expect(source).toContain('<span aria-hidden="true">←</span>')
  })
})
