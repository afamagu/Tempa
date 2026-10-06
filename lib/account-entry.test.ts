import { describe, it, expect } from 'vitest'
import { resolveAccountEntryDestination, type AccountEntryState } from './account-entry'

function baseState(overrides: Partial<AccountEntryState>): AccountEntryState {
  return {
    authenticated: true,
    languageConfirmed: true,
    eligibilityStatus: 'eligible',
    eligibleOn: null,
    legalCurrent: true,
    hasProfile: true,
    onboardingStage: 'complete',
    ...overrides,
  }
}

describe('resolveAccountEntryDestination', () => {
  it('unauthenticated -> /sign-in, regardless of any other state', () => {
    expect(resolveAccountEntryDestination(baseState({ authenticated: false, languageConfirmed: false }), '/letters')).toBe('/sign-in')
  })

  it('an authenticated account outside the controlled pilot is held at /pilot-access before onboarding', () => {
    expect(resolveAccountEntryDestination(baseState({ pilotAccess: false, languageConfirmed: false, eligibilityStatus: null }), '/home')).toBe('/pilot-access')
  })

  it('pilot access true continues into ordinary onboarding and undefined fails open for app-before-SQL deploy ordering', () => {
    expect(resolveAccountEntryDestination(baseState({ pilotAccess: true, languageConfirmed: false }), '/home')).toBe('/language')
    expect(resolveAccountEntryDestination(baseState({ pilotAccess: undefined, languageConfirmed: false }), '/home')).toBe('/language')
  })

  it('language is the first authenticated decision, before DOB/legal/profile setup', () => {
    expect(resolveAccountEntryDestination(baseState({ languageConfirmed: false }), '/home')).toBe('/language')
    expect(resolveAccountEntryDestination(baseState({ languageConfirmed: false, eligibilityStatus: null, hasProfile: false, onboardingStage: null }), '/home')).toBe('/language')
  })

  it('undefined language state fails open for safe app-before-SQL deploy ordering', () => {
    expect(resolveAccountEntryDestination(baseState({ languageConfirmed: undefined, eligibilityStatus: null }), '/home')).toBe('/begin')
  })

  it('authenticated, no eligibility state yet -> /begin', () => {
    expect(resolveAccountEntryDestination(baseState({ eligibilityStatus: null }), '/home')).toBe('/begin')
  })

  it('ineligible -> /begin (terminal state)', () => {
    expect(resolveAccountEntryDestination(baseState({ eligibilityStatus: 'ineligible' }), '/home')).toBe('/begin')
  })

  it('under manual review -> /begin', () => {
    expect(resolveAccountEntryDestination(baseState({ eligibilityStatus: 'review_required' }), '/home')).toBe('/begin')
  })

  it('eligible but required legal acceptance missing -> /begin', () => {
    expect(resolveAccountEntryDestination(baseState({ eligibilityStatus: 'eligible', legalCurrent: false }), '/home')).toBe('/begin')
  })

  it('eligible, legally current, no profile -> /profile', () => {
    expect(resolveAccountEntryDestination(baseState({ hasProfile: false, onboardingStage: null }), '/home')).toBe('/profile')
  })

  it('eligible, legally current, profile stage mark -> /profile/mark', () => {
    expect(resolveAccountEntryDestination(baseState({ onboardingStage: 'mark' }), '/home')).toBe('/profile/mark')
  })

  it('eligible, legally current, profile stage question -> /profile/question', () => {
    expect(resolveAccountEntryDestination(baseState({ onboardingStage: 'question' }), '/home')).toBe('/profile/question')
  })

  it('complete -> requested destination', () => {
    expect(resolveAccountEntryDestination(baseState({}), '/letters')).toBe('/letters')
  })

  it('ineligible wins over an otherwise-complete profile once language is confirmed', () => {
    expect(resolveAccountEntryDestination(baseState({ eligibilityStatus: 'ineligible' }), '/home')).toBe('/begin')
  })

  it('missing legal acceptance wins over an otherwise-complete profile once language is confirmed', () => {
    expect(resolveAccountEntryDestination(baseState({ legalCurrent: false }), '/home')).toBe('/begin')
  })
})
