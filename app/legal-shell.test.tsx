import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { LegalPageShell, LegalSection, LEGAL_PAGES } from './legal-shell'
import { OPERATOR_NAME, OPERATOR_ADDRESS_LINES, SUPPORT_EMAIL, SAFETY_EMAIL, PRIVACY_EMAIL, LEGAL_EMAIL } from '@/lib/legal'

const source = readFileSync(path.join(__dirname, 'legal-shell.tsx'), 'utf8')

// The shared shell behind all four public launch legal/safety pages
// (/terms, /privacy, /community-guidelines, /safety) — deliberately
// outside AppShell (app/app-shell.tsx), the same way /begin is (see
// app/begin/begin-flow.test.tsx's own "no AppShell" test), since these
// must be reachable and readable by a signed-out visitor and proxy.ts's
// matcher deliberately never covers them.

describe('LEGAL_PAGES — the canonical four-document set', () => {
  it('lists exactly the four confirmed public launch routes', () => {
    expect(LEGAL_PAGES.map((p) => p.href)).toEqual(['/terms', '/privacy', '/community-guidelines', '/safety'])
  })
})

function renderShell(currentHref: (typeof LEGAL_PAGES)[number]['href'] = '/terms') {
  return renderToStaticMarkup(
    <LegalPageShell title="Example Document" meta="Effective September 28, 2026" currentHref={currentHref}>
      <LegalSection heading="A section">
        <p>Body copy.</p>
      </LegalSection>
    </LegalPageShell>
  )
}

describe('LegalPageShell — never wraps in AppShell', () => {
  it('does not import or reference AppShell', () => {
    // Source-level guarantee, matching begin-flow.test.tsx's own check.
    expect(source).not.toContain('AppShell')
  })
})

describe('LegalPageShell — cross-document navigation', () => {
  it('renders a link to all four legal documents from any page', () => {
    const html = renderShell('/terms')
    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/community-guidelines"')
    expect(html).toContain('href="/safety"')
  })

  it('marks the current document with aria-current="page", and no other document', () => {
    const html = renderShell('/privacy')
    const privacyAnchorStart = html.indexOf('href="/privacy"')
    const privacyTagStart = html.lastIndexOf('<a ', privacyAnchorStart)
    const privacyTagEnd = html.indexOf('>', privacyAnchorStart)
    expect(html.slice(privacyTagStart, privacyTagEnd)).toContain('aria-current="page"')

    const termsAnchorStart = html.indexOf('href="/terms"')
    const termsTagStart = html.lastIndexOf('<a ', termsAnchorStart)
    const termsTagEnd = html.indexOf('>', termsAnchorStart)
    expect(html.slice(termsTagStart, termsTagEnd)).not.toContain('aria-current')
  })
})

describe('LegalPageShell — way back to Tempa/sign-in', () => {
  it('offers a link back to sign-in near the top, and back to Tempa in the footer', () => {
    const html = renderShell()
    expect(html).toContain('href="/sign-in"')
    expect(html).toContain('Back to sign in')
    expect(html).toContain('Back to Tempa')
  })
})

describe('LegalPageShell — operator and contact footer (confirmed launch facts)', () => {
  it('shows the operator name and full registered office address', () => {
    const html = renderShell()
    expect(html).toContain(OPERATOR_NAME)
    for (const line of OPERATOR_ADDRESS_LINES) {
      expect(html).toContain(line)
    }
  })

  it('shows all four canonical public contact email addresses, as mailto links', () => {
    const html = renderShell()
    for (const email of [SUPPORT_EMAIL, SAFETY_EMAIL, PRIVACY_EMAIL, LEGAL_EMAIL]) {
      expect(html).toContain(email)
      expect(html).toContain(`href="mailto:${email}"`)
    }
  })
})

describe('LegalPageShell — mobile-safe reading layout', () => {
  it('uses a sensible maximum reading width and responsive horizontal padding, never a fixed pixel width', () => {
    expect(source).toContain('max-w-2xl')
    expect(source).toContain('px-6')
    expect(source).not.toMatch(/w-\[\d+px\]/)
  })

  it('the page heading and section headings scale responsively (sm: breakpoint present)', () => {
    const html = renderShell()
    expect(html).toMatch(/class="[^"]*sm:/)
  })
})
