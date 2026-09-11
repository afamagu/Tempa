import { describe, it, expect } from 'vitest'
import { isAnnouncementHrefSafe } from './announcement-link-safety'

// SQL Hardening round, item 1 — the exact regression list required by
// the checkpoint, proving the backslash edge case is closed
// consistently through the one shared helper the editor and renderer
// both call (public.announcement_href_is_safe in
// docs/sql/2026-09-19-question-slots-and-premium-announcements.sql is
// the separately-hardened SQL twin of this same policy).
describe('isAnnouncementHrefSafe', () => {
  it('/settings -> allowed', () => {
    expect(isAnnouncementHrefSafe('/settings')).toBe(true)
  })

  it('/profile/example -> allowed', () => {
    expect(isAnnouncementHrefSafe('/profile/example')).toBe(true)
  })

  it('//evil.example -> rejected (protocol-relative)', () => {
    expect(isAnnouncementHrefSafe('//evil.example')).toBe(false)
  })

  it('/\\evil.example -> rejected (backslash edge case)', () => {
    expect(isAnnouncementHrefSafe('/\\evil.example')).toBe(false)
  })

  it('/\\\\evil.example -> rejected (backslash edge case)', () => {
    expect(isAnnouncementHrefSafe('/\\\\evil.example')).toBe(false)
  })

  it('javascript:alert(1) -> rejected', () => {
    expect(isAnnouncementHrefSafe('javascript:alert(1)')).toBe(false)
  })

  it('data:text/html,<script>alert(1)</script> -> rejected', () => {
    expect(isAnnouncementHrefSafe('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('https://example.com/path -> allowed', () => {
    expect(isAnnouncementHrefSafe('https://example.com/path')).toBe(true)
  })
})
