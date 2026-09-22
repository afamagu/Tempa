import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { LEGAL_PAGES } from './legal-shell'

// Repo-wide link audit for the four new public launch legal/safety
// pages — confirms /begin (the one existing place that already linked
// to these routes, frozen per the adult eligibility/legal gate rounds)
// now points at real pages rather than dead hrefs, and that no
// placeholder "#" href was ever left behind for any of the four
// documents.

const APP_DIR = __dirname
const BEGIN_FLOW_SOURCE = readFileSync(path.join(APP_DIR, 'begin', 'begin-flow.tsx'), 'utf8')
const LEGAL_SHELL_SOURCE = readFileSync(path.join(APP_DIR, 'legal-shell.tsx'), 'utf8')

const PAGE_SOURCES: Record<string, string> = Object.fromEntries(
  LEGAL_PAGES.map((page) => {
    const segment = page.href.slice(1)
    return [page.href, readFileSync(path.join(APP_DIR, segment, 'page.tsx'), 'utf8')]
  })
)

describe('Legal pages — every canonical route is real, nothing is a dead placeholder', () => {
  it('app/<segment>/page.tsx exists on disk for all four confirmed launch routes', () => {
    for (const page of LEGAL_PAGES) {
      const segment = page.href.slice(1)
      expect(existsSync(path.join(APP_DIR, segment, 'page.tsx'))).toBe(true)
    }
  })

  it('/begin\'s legal acceptance step links to the real canonical Terms/Privacy/Community Guidelines routes', () => {
    expect(BEGIN_FLOW_SOURCE).toContain('href="/terms"')
    expect(BEGIN_FLOW_SOURCE).toContain('href="/privacy"')
    expect(BEGIN_FLOW_SOURCE).toContain('href="/community-guidelines"')
  })

  it('no placeholder "#" href exists in /begin, the shared legal shell, or any of the four legal pages', () => {
    expect(BEGIN_FLOW_SOURCE).not.toMatch(/href=["']#["']/)
    expect(LEGAL_SHELL_SOURCE).not.toMatch(/href=["']#["']/)
    for (const source of Object.values(PAGE_SOURCES)) {
      expect(source).not.toMatch(/href=["']#["']/)
    }
  })

  it('the shared shell renders a nav link for every one of the four canonical documents', () => {
    for (const page of LEGAL_PAGES) {
      expect(LEGAL_SHELL_SOURCE).toContain(`href: '${page.href}'`)
    }
    expect(LEGAL_SHELL_SOURCE).toContain('href={page.href}')
  })

  it('every legal page declares a currentHref that matches one of the four canonical routes', () => {
    for (const [href, source] of Object.entries(PAGE_SOURCES)) {
      expect(source).toContain(`currentHref="${href}"`)
    }
  })
})

describe('Legal pages — no speculative DPO/representative/DCPMI language', () => {
  // These matters were explicitly ruled out of scope for this launch
  // checkpoint: Nigerian DCPMI classification, Nigerian/EU/UK Data
  // Protection Officer requirements, and EU Article 27 / UK
  // representative provisions. None of it should appear anywhere in the
  // shared shell or the four pages themselves.
  const FORBIDDEN_PATTERNS = [
    /data protection officer/i,
    /\bdpo\b/i,
    /dcpmi/i,
    /article\s*27/i,
    /eu representative/i,
    /uk representative/i,
    /eu-based representative/i,
  ]

  it('the shared shell and every legal page avoid all prohibited speculative compliance terms', () => {
    const allSources = [LEGAL_SHELL_SOURCE, ...Object.values(PAGE_SOURCES)]
    for (const source of allSources) {
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(source).not.toMatch(pattern)
      }
    }
  })
})

describe('Legal pages — no invented legal/compliance facts beyond what was confirmed', () => {
  it('never states a specific Supabase hosting region', () => {
    for (const source of Object.values(PAGE_SOURCES)) {
      expect(source.toLowerCase()).not.toMatch(/\b(us-east|us-west|eu-west|eu-central|ap-southeast|ap-northeast)-?\d?\b/)
    }
  })

  it('never asserts a specific governing-law jurisdiction for disputes', () => {
    for (const source of Object.values(PAGE_SOURCES)) {
      expect(source.toLowerCase()).not.toContain('governing law')
      expect(source.toLowerCase()).not.toContain('governed by the laws of')
    }
  })
})
