import Link from 'next/link'
import { systemHeadingClass, systemBodyClass } from '@/app/profile/ui'

/**
 * Deliberately generic — get_shared_dispatch returns the same empty
 * result for an invalid token, a revoked one, and one whose Dispatch is
 * no longer published, so this must never leak which of the three
 * actually happened. Board live-test corrections (2026-09-10): the
 * preferred copy direction included a line implying the writer chose to
 * stop sharing — that would leak "revoked" specifically, so it is
 * deliberately omitted here; the security/privacy rule wins over the
 * copy preference. Only the CTA's wording/positioning and routing
 * change from before; the failure message itself stays exactly as
 * generic as it already was.
 */
export default function DispatchUnavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <p className="font-serif text-lg italic text-foreground">Tempa</p>
        <h1 className={systemHeadingClass}>This Dispatch is no longer available.</h1>
        <p className={systemBodyClass}>
          <Link
            href="/sign-in?intent=join"
            className="underline decoration-foreground/30 underline-offset-4 hover:text-foreground"
          >
            Join Tempa
          </Link>{' '}
          — a pen-pal experience for thoughtful letters and the minds behind them.
        </p>
      </div>
    </main>
  )
}
