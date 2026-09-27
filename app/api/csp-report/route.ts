import { NextResponse } from 'next/server'
import { CSP_REPORT_MAX_BYTES, summarizeCspReports } from '@/lib/security/csp-report'

/**
 * Pre-beta security F-02 — receives Content-Security-Policy violation
 * reports (Report-Only phase) so the policy can be tuned before it is
 * enforced. Browsers post these without credentials, so this endpoint is
 * public by necessity: it reads at most 16 KB, logs only the violated
 * directive, the blocked resource's ORIGIN (or keyword such as `inline`)
 * and the document PATH — never query strings, full URLs, script samples
 * or any member content — and always answers 204.
 */

export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') ?? '0') > CSP_REPORT_MAX_BYTES) {
    return new NextResponse(null, { status: 204 })
  }
  try {
    const text = await request.text()
    if (text.length > 0 && text.length <= CSP_REPORT_MAX_BYTES) {
      for (const summary of summarizeCspReports(JSON.parse(text))) {
        console.warn('[csp-report]', summary)
      }
    }
  } catch {
    // Malformed reports are ignored.
  }
  return new NextResponse(null, { status: 204 })
}
