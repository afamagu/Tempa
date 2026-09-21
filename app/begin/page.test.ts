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

describe('/begin real sign-out (independent audit correction)', () => {
  const fnStart = source.indexOf('async function signOutAndReturnToSignIn()')
  const fnEnd = source.indexOf('\nexport default async function BeginPage')
  const body = source.slice(fnStart, fnEnd)

  it('is a real Server Action (\'use server\'), matching app/you/page.tsx\'s existing sign-out conventions', () => {
    expect(body).toContain("'use server'")
    expect(body).toContain('await supabase.auth.signOut()')
    expect(body).toContain("redirect('/sign-in')")
  })

  it('uses restrained error handling — sign-out failure still redirects to /sign-in rather than stranding the member', () => {
    expect(body).toContain('try {')
    expect(body).toContain('catch')
    // redirect() must sit OUTSIDE the try block — Next.js's redirect()
    // throws internally, so wrapping it in the same try/catch would
    // risk the catch swallowing the redirect itself.
    const tryStart = body.indexOf('try {')
    const catchEnd = body.indexOf('}', body.indexOf('catch'))
    const redirectPos = body.indexOf("redirect('/sign-in')")
    expect(redirectPos).toBeGreaterThan(catchEnd)
    expect(tryStart).toBeGreaterThan(-1)
  })

  it('is passed to BeginFlow as signOutAction, not left unused', () => {
    expect(source).toContain('signOutAction={signOutAndReturnToSignIn}')
  })
})
