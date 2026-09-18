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
})

