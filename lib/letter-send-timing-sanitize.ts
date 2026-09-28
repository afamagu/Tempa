// Server-side validation for lib/letter-send-timing.ts reports: only
// known fields, only bounded non-negative numbers, only a well-formed
// Server-Timing string. Anything else is dropped.

const OUTCOMES = new Set(['sent', 'already_sent', 'failed', 'blocked', 'warning'])
const MS_FIELDS = ['evaluateMs', 'writeMs', 'navigateMs', 'totalMs'] as const
const NET_FIELDS = ['dns', 'connect', 'tls', 'ttfb', 'download', 'duration'] as const
const SERVER_TIMING = /^[a-z_]+;dur=\d{1,7}(\.\d)?(, [a-z_]+;dur=\d{1,7}(\.\d)?){0,9}$/
const MAX_MS = 600_000

const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_MS ? Math.round(v) : null)

function net(v: unknown) {
  if (typeof v !== 'object' || v === null) return null
  const src = v as Record<string, unknown>
  const out: Record<string, number | null> = {}
  for (const k of NET_FIELDS) out[k] = ms(src[k])
  return out
}

export function sanitizeLetterSendTiming(raw: unknown) {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r.surface !== 'write_anytime' || typeof r.outcome !== 'string' || !OUTCOMES.has(r.outcome)) return null
  const out: Record<string, unknown> = { surface: r.surface, outcome: r.outcome, retry: r.retry === true }
  for (const k of MS_FIELDS) out[k] = ms(r[k])
  out.evaluateServer = typeof r.evaluateServer === 'string' && SERVER_TIMING.test(r.evaluateServer) ? r.evaluateServer : null
  out.evaluateNet = net(r.evaluateNet)
  out.writeNet = net(r.writeNet)
  return out
}
