import { describe, it, expect } from 'vitest'
import { resolveAccountEntryDestination, type AccountEntryState } from './account-entry'

function baseState(overrides: Partial<AccountEntryState>): AccountEntryState {
  return {
    authenticated: true,
    eligibilityStatus: 'eligible',
    eligibleOn: null,
    legalCurrent: true,
    hasProfile: true,
    onboardingStage: 'complete',
    ...overrides,
  }
}

describe('resolveAccountEntryDestination', () => {
  it('1. unauthenticated -> /sign-in, regardless of any other state', () => {
    expect(resolveAccountEntryDestination(baseState({ authenticated: false }), '/letters')).toBe('/sign-in')
  })

  it('2. authenticated, no eligibility state yet -> /begin', () => {
    expect(resolveAccountEntryDestination(baseState({ eligibilityStatus: null }), '/home')).toBe('/begin')
  })

  it('3. ineligible -> /begin (terminal state)', () => {
    expect(resolveAccountEntryDestination(baseState({ eligibilityStatus: 'ineligible' }), '/home')).toBe('/begin')
  })

  it('under manual review -> /begin', () => {
    expect(resolveAccountEntryDestination(baseState({ eligibilityStatus: 'review_required' }), '/home')).toBe(
      '/begin'
    )
  })

  it('4. eligible but required legal acceptance missing -> /begin', () => {
    expect(
      resolveAccountEntryDestination(baseState({ eligibilityStatus: 'eligible', legalCurrent: false }), '/home')
    ).toBe('/begin')
  })

  it('5. eligible, legally current, no profile -> /profile', () => {
    expect(
      resolveAccountEntryDestination(
        baseState({ eligibilityStatus: 'eligible', legalCurrent: true, hasProfile: false, onboardingStage: null }),
        '/home'
      )
    ).toBe('/profile')
  })

  it('6. eligible, legally current, profile stage mark -> /profile/mark', () => {
    expect(
      resolveAccountEntryDestination(
        baseState({ eligibilityStatus: 'eligible', legalCurrent: true, hasProfile: true, onboardingStage: 'mark' }),
        '/home'
      )
    ).toBe('/profile/mark')
  })

  it('7. eligible, legally current, profile stage question -> /profile/question', () => {
    expect(
      resolveAccountEntryDestination(
        baseState({
          eligibilityStatus: 'eligible',
          legalCurrent: true,
          hasProfile: true,
          onboardingStage: 'question',
        }),
        '/home'
      )
    ).toBe('/profile/question')
  })

  it('8. complete -> requested safe destination', () => {
    expect(
      resolveAccountEntryDestination(
        baseState({
          eligibilityStatus: 'eligible',
          legalCurrent: true,
          hasProfile: true,
          onboardingStage: 'complete',
        }),
        '/letters'
      )
    ).toBe('/letters')
  })

  it('ineligible always wins over an otherwise-complete profile — eligibility is checked before delegating to profile onboarding', () => {
    expect(
      resolveAccountEntryDestination(
        baseState({
          eligibilityStatus: 'ineligible',
          hasProfile: true,
          onboardingStage: 'complete',
        }),
        '/home'
      )
    ).toBe('/begin')
  })

  it('missing legal acceptance always wins over an otherwise-complete profile', () => {
    expect(
      resolveAccountEntryDestination(
        baseState({
          eligibilityStatus: 'eligible',
          legalCurrent: false,
          hasProfile: true,
          onboardingStage: 'complete',
        }),
        '/home'
      )
    ).toBe('/begin')
  })

  it('unauthenticated wins over every other field, even a fully-eligible-looking state', () => {
    expect(
      resolveAccountEntryDestination(
        baseState({
          authenticated: false,
          eligibilityStatus: 'eligible',
          legalCurrent: true,
          hasProfile: true,
          onboardingStage: 'complete',
        }),
        '/letters'
      )
    ).toBe('/sign-in')
  })
})
