import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'proxy.ts'), 'utf8')

describe('central onboarding enforcement', () => {
  it('uses the shared account-entry resolver and reads the private onboarding stage', () => {
    expect(source).toContain('resolveAccountEntryDestination')
    expect(source).toContain("select('id, onboarding_stage')")
  })

  it('covers authenticated member surfaces, including direct navigation around onboarding', () => {
    for (const route of ['/home/:path*', '/letters/:path*', '/minds/:path*', '/profile/:path*', '/question/:path*', '/write/:path*', '/you/:path*']) {
      expect(source).toContain(`'${route}'`)
    }
  })
})

describe('Adult Eligibility + Legal Acceptance Gate — proxy enforcement', () => {
  it('reads the account-level eligibility and legal-acceptance state alongside profile state', () => {
    expect(source).toContain("from('account_eligibility')")
    expect(source).toContain("select('status')")
    expect(source).toContain("from('legal_acceptances')")
    expect(source).toContain("select('document_type, document_version')")
    expect(source).toContain('isLegalCurrent(')
  })

  it('redirects an authenticated-but-incomplete account to /begin with the original destination preserved as `next`', () => {
    expect(source).toContain("destination === '/begin'")
    const blockStart = source.indexOf("destination === '/begin'")
    const blockEnd = source.indexOf('if (destination !== requestedDestination)', blockStart)
    const block = source.slice(blockStart, blockEnd)
    expect(block).toContain("new URL('/begin', request.url)")
    expect(block).toContain("beginUrl.searchParams.set('next', requestedDestination)")
  })

  it('`/begin` itself is never one of the matched/intercepted routes — no possibility of a proxy-driven redirect loop', () => {
    const matcherStart = source.indexOf('matcher: [')
    const matcherEnd = source.indexOf(']', matcherStart)
    const matcherBlock = source.slice(matcherStart, matcherEnd)
    expect(matcherBlock).not.toContain('/begin')
  })

  it('public legal document routes are not in the matcher — /terms, /privacy, /community-guidelines, /safety stay reachable without any account-entry state', () => {
    const matcherStart = source.indexOf('matcher: [')
    const matcherEnd = source.indexOf(']', matcherStart)
    const matcherBlock = source.slice(matcherStart, matcherEnd)
    for (const route of ['/terms', '/privacy', '/community-guidelines', '/safety']) {
      expect(matcherBlock).not.toContain(route)
    }
  })
})

describe('permanent ban — proxy enforcement', () => {
  it("reads the caller's OWN status via current_account_status and redirects a banned account to /account-unavailable", () => {
    expect(source).toContain("supabase.rpc('current_account_status')")
    const start = source.indexOf("accountStatus === 'banned'")
    expect(start).toBeGreaterThan(-1)
    expect(source.slice(start, start + 200)).toContain("new URL('/account-unavailable', request.url)")
  })

  it('runs before the account-entry redirects, so a banned account never reaches /begin or any member surface', () => {
    expect(source.indexOf("accountStatus === 'banned'")).toBeLessThan(source.indexOf('resolveAccountEntryDestination('))
  })

  it('/account-unavailable is not a matched route — no possibility of a redirect loop', () => {
    const matcherStart = source.indexOf('matcher: [')
    const matcherBlock = source.slice(matcherStart, source.indexOf(']', matcherStart))
    expect(matcherBlock).not.toContain('account-unavailable')
  })
})
