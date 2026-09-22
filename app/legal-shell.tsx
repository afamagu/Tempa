import Link from 'next/link'
import type { ReactNode } from 'react'
import { pageTitleClass, sectionTitleClass, systemBodyClass, helperTextClass, quietLinkClass } from '@/app/profile/ui'
import { OPERATOR_NAME, OPERATOR_ADDRESS_LINES, SUPPORT_EMAIL, SAFETY_EMAIL, PRIVACY_EMAIL, LEGAL_EMAIL } from '@/lib/legal'

// The four public launch legal/safety pages (/terms, /privacy,
// /community-guidelines, /safety) share this one shell so they read as
// a single family of first-class Tempa documents — same wordmark,
// same cross-document nav, same footer/contact block — rather than
// four independently-styled pages. Deliberately outside the app's
// primary navigation chrome (see app/app-shell.tsx), the same way
// /begin is (app/begin/begin-flow.tsx makes the same choice) — these
// must be reachable and readable by a signed-out visitor, and
// proxy.ts's matcher deliberately never covers them.

export const LEGAL_PAGES = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Notice' },
  { href: '/community-guidelines', label: 'Community Guidelines' },
  { href: '/safety', label: 'Safety' },
] as const

export type LegalPageHref = (typeof LEGAL_PAGES)[number]['href']

const wordmarkClass = 'font-serif text-xs italic tracking-[0.2em] text-muted'

export function LegalPageShell({
  title,
  meta,
  currentHref,
  children,
}: {
  title: string
  meta?: ReactNode
  currentHref: LegalPageHref
  children: ReactNode
}) {
  return (
    <main className="min-h-screen bg-background px-6 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-2xl space-y-10">
        <header className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className={wordmarkClass}>
              Tempa
            </Link>
            <Link href="/sign-in" className={quietLinkClass}>
              Back to sign in
            </Link>
          </div>

          <div className="space-y-1.5">
            <h1 className={pageTitleClass}>{title}</h1>
            {meta ? <p className={helperTextClass}>{meta}</p> : null}
          </div>

          <nav aria-label="Legal documents" className="flex flex-wrap gap-x-5 gap-y-2 border-y border-foreground/10 py-3">
            {LEGAL_PAGES.map((page) => {
              const isCurrent = page.href === currentHref
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={
                    isCurrent
                      ? 'text-[14px] font-medium text-foreground'
                      : 'text-[14px] font-medium text-foreground/60 underline decoration-foreground/25 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/60'
                  }
                >
                  {page.label}
                </Link>
              )
            })}
          </nav>
        </header>

        <div className="space-y-8">{children}</div>

        <footer className="space-y-3 border-t border-foreground/10 pt-6">
          <p className={helperTextClass}>
            {OPERATOR_NAME}
            <br />
            {OPERATOR_ADDRESS_LINES.map((line) => (
              <span key={line}>
                {line}
                <br />
              </span>
            ))}
          </p>

          <p className={helperTextClass}>
            Support: <a href={`mailto:${SUPPORT_EMAIL}`} className={quietLinkClass}>{SUPPORT_EMAIL}</a>
            {' · '}
            Safety: <a href={`mailto:${SAFETY_EMAIL}`} className={quietLinkClass}>{SAFETY_EMAIL}</a>
            {' · '}
            Privacy: <a href={`mailto:${PRIVACY_EMAIL}`} className={quietLinkClass}>{PRIVACY_EMAIL}</a>
            {' · '}
            Legal: <a href={`mailto:${LEGAL_EMAIL}`} className={quietLinkClass}>{LEGAL_EMAIL}</a>
          </p>

          <p>
            <Link href="/" className={quietLinkClass}>
              Back to Tempa
            </Link>
          </p>
        </footer>
      </div>
    </main>
  )
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className={sectionTitleClass}>{heading}</h2>
      <div className={`space-y-3 ${systemBodyClass}`}>{children}</div>
    </section>
  )
}

export const legalListClass = 'list-disc space-y-1.5 pl-5'
