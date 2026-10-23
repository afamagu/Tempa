import { describe, expect, it } from 'vitest'
import { resolveOnboardingDestination, type OnboardingStage } from './onboarding'

describe('resolveOnboardingDestination', () => {
  it('implements the complete durable routing matrix', () => {
    const cases: Array<{
      authenticated: boolean
      hasProfile: boolean
      onboardingStage: OnboardingStage | null
      expected: string
    }> = [
      { authenticated: false, hasProfile: false, onboardingStage: null, expected: '/sign-in' },
      { authenticated: true, hasProfile: false, onboardingStage: null, expected: '/profile' },
      { authenticated: true, hasProfile: true, onboardingStage: 'mark', expected: '/profile/mark' },
      { authenticated: true, hasProfile: true, onboardingStage: 'question', expected: '/profile/question' },
      { authenticated: true, hasProfile: true, onboardingStage: 'complete', expected: '/letters' },
    ]

    for (const testCase of cases) {
      expect(resolveOnboardingDestination(testCase, '/letters')).toBe(testCase.expected)
    }
  })

  it('never honors a requested normal destination for an incomplete member', () => {
    for (const onboardingStage of ['mark', 'question'] as const) {
      expect(
        resolveOnboardingDestination(
          { authenticated: true, hasProfile: true, onboardingStage },
          '/board/some-dispatch'
        )
      ).not.toBe('/board/some-dispatch')
    }
  })

  it('grandfathered complete members retain their requested destination unchanged', () => {
    expect(
      resolveOnboardingDestination(
        { authenticated: true, hasProfile: true, onboardingStage: 'complete' },
        '/you/responses?tab=new'
      )
    ).toBe('/you/responses?tab=new')
  })
  it('routes only opted-in new arrivals through writing then Auto-Match, with safe editing exemptions', () => {
    const state = {authenticated:true,hasProfile:true,onboardingStage:'complete' as const,firstLetterPending:true}
    expect(resolveOnboardingDestination(state,'/home')).toBe('/welcome/letter')
    expect(resolveOnboardingDestination(state,'/welcome/people')).toBe('/welcome/letter')
    expect(resolveOnboardingDestination(state,'/welcome/letter?published=1')).toBe('/welcome/letter?published=1')
    expect(resolveOnboardingDestination(state,'/board/guided?firstArrival=1')).toBe('/board/guided?firstArrival=1')
    expect(resolveOnboardingDestination(state,'/board/write?firstArrival=1')).toBe('/board/write?firstArrival=1')
    expect(resolveOnboardingDestination({...state,firstLetterPending:false,firstAutoMatchPending:true},'/home')).toBe('/welcome/people')
    expect(resolveOnboardingDestination({...state,firstLetterPending:false,firstAutoMatchPending:true},'/welcome/people')).toBe('/welcome/people')
    expect(resolveOnboardingDestination({...state,firstLetterPending:false,firstAutoMatchPending:false},'/home')).toBe('/home')
  })

  it('never loops between welcome and Mark during first arrival, even when mark lookup is unavailable', () => {
    const markless = {
      authenticated: true,
      hasProfile: true,
      onboardingStage: 'complete' as const,
      firstArrivalPending: true,
      needsMark: true,
    }
    expect(resolveOnboardingDestination(markless, '/welcome')).toBe('/you/mark')
    expect(resolveOnboardingDestination(markless, '/you/mark')).toBe('/you/mark')
    expect(resolveOnboardingDestination(markless, '/home')).toBe('/you/mark')
    expect(resolveOnboardingDestination(markless, '/you/mark?replace=1')).toBe('/you/mark?replace=1')

    const unreadableMark = { ...markless, needsMark: undefined }
    expect(resolveOnboardingDestination(unreadableMark, '/welcome')).toBe('/welcome')
    expect(resolveOnboardingDestination(unreadableMark, '/you/mark')).toBe('/you/mark')
    expect(resolveOnboardingDestination(unreadableMark, '/profile/mark')).toBe('/profile/mark')
    expect(resolveOnboardingDestination(unreadableMark, '/profile')).toBe('/profile')
    expect(resolveOnboardingDestination(unreadableMark, '/board')).toBe('/welcome')
  })

})
