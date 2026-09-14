import type { Metadata } from 'next'
import Link from 'next/link'
import { validateConfirmationUrl } from '@/lib/auth-confirm'

// Final hardening pass — this route's URL carries a one-time,
// credential-bearing ConfirmationURL as a query param, so it must never
// be indexed (a crawler following an indexed link would burn the human's
// own token) and must never be served as reusable, cached HTML (the
// query param — and therefore the page's own meaning — is different on
// every visit). Reading `searchParams` below already opts this page into
// per-request dynamic rendering on its own (Next's own documented
// behavior — see node_modules/next/dist/docs .../file-conventions/page.md,
// "searchParams is a Request-time API ... opt the page into dynamic
// rendering"), but `dynamic` is set explicitly anyway so that guarantee
// doesn't silently depend on this file continuing to read searchParams —
// the smallest, self-documenting way to pin it down for a
// credential-bearing route.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

/**
 * Checkpoint 1, Phase B — the prefetch-safe Magic Link intermediate
 * page. A deliberate SERVER COMPONENT with no client-side script at
 * all for its own core function: this structurally guarantees there is
 * no `useEffect`, no meta-refresh, no timer, and no auto-navigation of
 * any kind that could follow the real Supabase `ConfirmationURL`
 * without a genuine human click. An email security scanner/prefetcher
 * can GET this route as many times as it wants — rendering it performs
 * NO auth verification and NO token exchange, so nothing here can ever
 * consume the single-use magic-link token.
 *
 * Only the visible "Sign in to TEMPA" button — a plain `<a href>`,
 * deliberately never a Next.js `<Link>` (which can prefetch) —
 * navigates to the real, validated ConfirmationURL, and only when a
 * human actually clicks it.
 *
 * The email template (Section G of this checkpoint) points here with
 * `?confirmation_url=<the real Supabase ConfirmationURL>` rather than
 * linking `{{ .ConfirmationURL }}` directly. validateConfirmationUrl
 * (lib/auth-confirm.ts) is the actual security boundary — this page
 * never renders a link to anything that fails that check, so it can
 * never become an open redirect to an attacker-controlled host.
 */
export default async function AuthConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmation_url?: string }>
}) {
  const { confirmation_url } = await searchParams
  const validatedUrl = validateConfirmationUrl(confirmation_url, process.env.NEXT_PUBLIC_SUPABASE_URL)

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-sm w-full space-y-4 rounded-md border border-foreground/12 p-6 text-center">
        <p className="font-serif text-2xl font-medium">TEMPA</p>

        {validatedUrl ? (
          <>
            <p className="text-sm">Your sign-in is ready.</p>
            <p className="text-sm text-muted">
              For your security, sign-in links are only opened after you choose to continue.
            </p>
            <a
              href={validatedUrl}
              referrerPolicy="no-referrer"
              className="block w-full rounded-md bg-accent text-accent-foreground px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent/90"
            >
              Sign in to TEMPA
            </a>
            <p className="text-xs text-muted">If you didn&apos;t request this email, you can close this page.</p>
          </>
        ) : (
          <>
            <p className="text-sm">This sign-in link isn&apos;t valid.</p>
            <p className="text-sm text-muted">Please request a new sign-in link and use the most recent email.</p>
            <Link
              href="/sign-in"
              className="block w-full rounded-md border border-foreground/15 px-3 py-2 text-sm font-medium transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]"
            >
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  )
}
