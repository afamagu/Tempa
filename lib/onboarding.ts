export type OnboardingStage = 'mark' | 'question' | 'complete'

export type OnboardingState = {
  authenticated: boolean
  hasProfile: boolean
  onboardingStage: OnboardingStage | null
}

/**
 * The one durable routing decision for member onboarding. A requested
 * destination is honored only after the profile's onboarding stage is
 * complete; incomplete members always resume at their exact next step.
 */
export function resolveOnboardingDestination(
  state: OnboardingState,
  requestedDestination: string
): string {
  if (!state.authenticated) return '/sign-in'
  if (!state.hasProfile) return '/profile'
  if (state.onboardingStage === 'mark') return '/profile/mark'
  if (state.onboardingStage === 'question') return '/profile/question'
  return requestedDestination
}

