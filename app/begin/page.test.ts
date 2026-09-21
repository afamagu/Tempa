import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('/begin server guards', () => {
  it('requires auth, preserving `next` through the sign-in round trip', () => {
    expect(source).toContain("redirect(`/sign-in?next=${encodeURIComponent(signInNext)}`)")
  })

  it('reads all three account-entry data sources: profile, eligibility, legal acceptances', () => {
    expect(source).toContain("from('profiles')")
    expect(source).toContain("from('account_eligibility')")
    expect(source).toContain("from('legal_acceptances')")
  })

  it('never selects the exact date_of_birth column — only status/eligible_on ever reach this server component', () => {
    const selectCalls = source.match(/\.select\('[^']*'\)/g) ?? []
    const eligibilitySelect = selectCalls.find((c) => c.includes('status'))
    expect(eligibilitySelect).toBeDefined()
    expect(eligibilitySelect).not.toContain('date_of_birth')
  })

  it('uses the shared account-entry resolver, never a bespoke inline routing decision', () => {
    expect(source).toContain('resolveAccountEntryDestination(')
  })

  it('redirects away from /begin immediately once the resolver says the gate is already satisfied', () => {
    expect(source).toContain("if (destination !== '/begin') {")
    expect(source).toContain('redirect(destination)')
  })

  it('computes stillBlocked from a persisted eligible_on date, never from ephemeral client state', () => {
    expect(source).toContain("eligibilityStatus === 'ineligible'")
    expect(source).toContain('eligibility!.eligible_on! > today')
  })
})
