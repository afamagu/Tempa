import { describe, it, expect } from 'vitest'
import { sanitizeLetterSendTiming } from './letter-send-timing-sanitize'

describe('sanitizeLetterSendTiming — durations only, bounded, well-formed', () => {
  it('keeps known numeric fields (rounded) and a valid Server-Timing string', () => {
    const out = sanitizeLetterSendTiming({
      surface: 'write_anytime',
      outcome: 'sent',
      evaluateMs: 812.4,
      evaluateServer: 'auth;dur=40.2, rate_limit;dur=12.0, total;dur=300.1',
      writeMs: 1500.6,
      navigateMs: 2200,
      totalMs: 4600,
      evaluateNet: { dns: 0, connect: 120, tls: 80, ttfb: 600, download: 3, duration: 810 },
      retry: true,
    })
    expect(out).toMatchObject({ outcome: 'sent', evaluateMs: 812, writeMs: 1501, retry: true, evaluateServer: 'auth;dur=40.2, rate_limit;dur=12.0, total;dur=300.1' })
    expect(out?.evaluateNet).toEqual({ dns: 0, connect: 120, tls: 80, ttfb: 600, download: 3, duration: 810 })
  })

  it('drops content-like, negative, huge or unknown values; rejects unknown surfaces/outcomes', () => {
    const out = sanitizeLetterSendTiming({
      surface: 'write_anytime',
      outcome: 'failed',
      evaluateMs: -5,
      writeMs: 9e9,
      navigateMs: 'Dear friend',
      evaluateServer: 'body;desc="Dear friend"',
      body: 'Dear friend',
    })
    expect(out).toMatchObject({ evaluateMs: null, writeMs: null, navigateMs: null, evaluateServer: null })
    expect(JSON.stringify(out)).not.toContain('Dear friend')
    expect(sanitizeLetterSendTiming({ surface: 'dispatch', outcome: 'sent' })).toBeNull()
    expect(sanitizeLetterSendTiming({ surface: 'write_anytime', outcome: 'maybe' })).toBeNull()
    expect(sanitizeLetterSendTiming(null)).toBeNull()
  })
})
