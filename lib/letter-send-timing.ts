// Letter-send latency report (client side). Measures one Send end to end,
// split into the phases that can actually be told apart from the
// browser, and posts ONLY durations (never letter content) to
// /api/perf/letter-send, where they are logged with the request's
// country and Vercel edge so slow regions can be compared.
//
//   evaluateMs      tap -> /api/safety/evaluate response (Vercel, iad1)
//   evaluateServer  that route's own Server-Timing (auth, rate_limit,
//                   authorize, classify, record, total) — server work;
//                   evaluateMs minus its total is network + queueing
//   writeMs         write_letter_once RPC, browser -> Supabase directly
//                   (network + database; database time is in Supabase's
//                   API logs as origin_time)
//   navigateMs      acknowledgement -> the next page actually rendered
//   *Net            browser Resource Timing for each request (dns,
//                   connect, tls, ttfb, download) where the browser
//                   exposes it
//   totalMs         tap -> next page rendered

export type LetterSendOutcome = 'sent' | 'already_sent' | 'failed' | 'blocked' | 'warning'

export type ResourceNet = { dns: number; connect: number; tls: number; ttfb: number; download: number; duration: number }

export type LetterSendTiming = {
  surface: 'write_anytime'
  outcome: LetterSendOutcome
  evaluateMs?: number
  evaluateServer?: string | null
  writeMs?: number
  navigateMs?: number
  totalMs?: number
  evaluateNet?: ResourceNet | null
  writeNet?: ResourceNet | null
  retry?: boolean
}

/** A fresh timing record for one Send, started now. */
export function startLetterSendTiming(): { start: number; ackAt?: number; report: LetterSendTiming } {
  return { start: performance.now(), report: { surface: 'write_anytime', outcome: 'failed' } }
}

const round = (n: number) => Math.max(0, Math.round(n))

/** The most recent Resource Timing entry whose URL contains `fragment`. */
export function resourceNet(fragment: string): ResourceNet | null {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return null
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (!e.name.includes(fragment)) continue
    return {
      dns: round(e.domainLookupEnd - e.domainLookupStart),
      connect: round(e.connectEnd - e.connectStart),
      tls: e.secureConnectionStart > 0 ? round(e.connectEnd - e.secureConnectionStart) : 0,
      ttfb: e.responseStart > 0 ? round(e.responseStart - e.requestStart) : 0,
      download: e.responseStart > 0 ? round(e.responseEnd - e.responseStart) : 0,
      duration: round(e.duration),
    }
  }
  return null
}

export function reportLetterSendTiming(timing: LetterSendTiming): void {
  try {
    const body = JSON.stringify(timing)
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/perf/letter-send', new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch('/api/perf/letter-send', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true })
  } catch {
    // Measurement must never affect sending.
  }
}
