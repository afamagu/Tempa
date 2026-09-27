// Pre-beta security F-02 — privacy-preserving summary of CSP violation
// reports: directive, blocked ORIGIN (or keyword), document PATH only.

export const CSP_REPORT_MAX_BYTES = 16 * 1024

type Report = Record<string, unknown>

function originOrKeyword(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return 'unknown'
  try {
    return new URL(value).origin
  } catch {
    return value.slice(0, 32)
  }
}

function pathOnly(value: unknown): string {
  if (typeof value !== 'string') return 'unknown'
  try {
    return new URL(value).pathname.slice(0, 120)
  } catch {
    return 'unknown'
  }
}

export function summarizeCspReports(body: unknown): { directive: string; blocked: string; path: string }[] {
  const entries: Report[] = Array.isArray(body)
    ? body.map((r) => ((r as Report)?.body ?? r) as Report)
    : [((body as Report)?.['csp-report'] ?? body) as Report]
  return entries.slice(0, 10).map((r) => ({
    directive: String(r?.['effective-directive'] ?? r?.effectiveDirective ?? r?.['violated-directive'] ?? 'unknown').slice(0, 40),
    blocked: originOrKeyword(r?.['blocked-uri'] ?? r?.blockedURL),
    path: pathOnly(r?.['document-uri'] ?? r?.documentURL),
  }))
}
