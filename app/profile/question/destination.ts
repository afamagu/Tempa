export function resolveOnboardingQuestionDestination(state: {
  hasProfile: boolean
  onboardingStage: 'mark' | 'question' | 'complete' | null
  hasFlagshipQuestion: boolean
  hasFlagshipAnswer: boolean
}): 'render' | 'recover' | '/profile' | '/profile/mark' | '/home' {
  if (!state.hasProfile) return '/profile'
  if (state.onboardingStage === 'mark') return '/profile/mark'
  if (state.onboardingStage === 'complete') return '/home'
  if (!state.hasFlagshipQuestion || state.hasFlagshipAnswer) return 'recover'
  return 'render'
}
