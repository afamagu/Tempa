import { describe, it, expect } from 'vitest'
import { sanitizeInternalPath } from './safe-redirect'

describe('sanitizeInternalPath', () => {
  it('accepts a plain internal path', () => {
    expect(sanitizeInternalPath('/admin')).toBe('/admin')
  })

  it('accepts an internal path with a nested segment, query, and hash', () => {
    expect(sanitizeInternalPath('/admin/reports/abc-123?tab=open#top')).toBe(
      '/admin/reports/abc-123?tab=open#top'
    )
  })

  it('rejects null/undefined/empty', () => {
    expect(sanitizeInternalPath(null)).toBeNull()
    expect(sanitizeInternalPath(undefined)).toBeNull()
    expect(sanitizeInternalPath('')).toBeNull()
  })

  it('rejects a path with no leading slash', () => {
    expect(sanitizeInternalPath('admin')).toBeNull()
    expect(sanitizeInternalPath('evil.com/admin')).toBeNull()
  })

  it('rejects a protocol-relative URL (the classic open-redirect bypass)', () => {
    expect(sanitizeInternalPath('//evil.com')).toBeNull()
    expect(sanitizeInternalPath('//evil.com/admin')).toBeNull()
  })

  it('rejects a backslash-prefixed path (browsers normalize \\ to / for special schemes)', () => {
    expect(sanitizeInternalPath('/\\evil.com')).toBeNull()
    expect(sanitizeInternalPath('/\\/evil.com')).toBeNull()
  })

  it('rejects an absolute URL to another origin', () => {
    expect(sanitizeInternalPath('https://evil.com')).toBeNull()
    expect(sanitizeInternalPath('http://evil.com/admin')).toBeNull()
  })

  it('rejects a non-http(s) scheme', () => {
    expect(sanitizeInternalPath('javascript:alert(1)')).toBeNull()
    expect(sanitizeInternalPath('data:text/html,evil')).toBeNull()
  })

  it('rejects an overlong path', () => {
    expect(sanitizeInternalPath('/' + 'a'.repeat(3000))).toBeNull()
  })
})
