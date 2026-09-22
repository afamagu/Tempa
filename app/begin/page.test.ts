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

  it('8. passes the persisted eligible_on through to BeginFlow, so the under-18 terminal can display it', () => {
    expect(source).toContain('eligibleOn={eligibility?.eligible_on ?? null}')
  })
})

describe('/begin real sign-out wiring (independent audit correction)', () => {
  // The actual sign-out behavior (returned-error inspection, restrained
  // logging, redirect) now lives in its own testable module,
  // ./sign-out-action.ts — see sign-out-action.test.ts for the
  // behavioral coverage (including the returned-error shape, not only
  // source-text presence). This file only proves the wiring: page.tsx
  // imports the real action and actually passes it through, rather
  // than defining its own or leaving it unused.
  it('imports signOutAndReturnToSignIn from ./sign-out-action, not a local/inline definition', () => {
    expect(source).toContain("import { signOutAndReturnToSignIn } from './sign-out-action'")
    expect(source).not.toContain("async function signOutAndReturnToSignIn()")
  })

  it('is passed to BeginFlow as signOutAction, not left unused', () => {
    expect(source).toContain('signOutAction={signOutAndReturnToSignIn}')
  })
})
