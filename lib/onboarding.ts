export type OnboardingStage = 'mark' | 'question' | 'complete'

export type OnboardingState = {
  authenticated: boolean
  hasProfile: boolean
  onboardingStage: OnboardingStage | null
  /** Writing Style (docs/sql/2026-10-29-writing-style.sql) — true only when
   * the entry-state read positively reported that this member has NOT yet
   * chosen a style. Absent/false (including an app deployed before the
   * migration) never gates anything. */
  needsWritingStyle?: boolean
}

/** The one-time Writing Style step — step 4 of onboarding for a new
 * member (after The First Question), and the single interruption an
 * already-onboarded member sees once after release. Derived purely from
 * "complete, but no valid style yet": never a separate stage value, never
 * a local "already seen" flag. */
export const WRITING_STYLE_PATH = '/profile/writing-style'

/** Where The First Question's completion screen continues to. */
export const WRITING_STYLE_ONBOARDING_HREF = `${WRITING_STYLE_PATH}?next=%2Froom`

// Routes that must stay reachable before a style is chosen: the step
// itself, account & privacy (pausing/closing an account is never held
// behind a presentation choice) and staff tools.
const WRITING_STYLE_EXEMPT_PREFIXES = [WRITING_STYLE_PATH, '/you/account', '/admin']

export function isWritingStyleExemptPath(destination: string): boolean {
  const pathname = destination.split(/[?#]/, 1)[0]
  return WRITING_STYLE_EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function writingStyleStepHref(requestedDestination: string): string {
  return `${WRITING_STYLE_PATH}?next=${encodeURIComponent(requestedDestination)}`
}

/**
 * The one durable routing decision for member onboarding. A requested
 * destination is honored only after the profile's onboarding stage is
 * complete; incomplete members always resume at their exact next step.
 * A complete member without a Writing Style is sent to that step once,
 * carrying where they were going so they continue there afterwards.
 */
export function resolveOnboardingDestination(
  state: OnboardingState,
  requestedDestination: string
): string {
  if (!state.authenticated) return '/sign-in'
  if (!state.hasProfile) return '/profile'
  if (state.onboardingStage === 'mark') return '/profile/mark'
  if (state.onboardingStage === 'question') return '/profile/question'
  if (state.needsWritingStyle === true && !isWritingStyleExemptPath(requestedDestination)) {
    return writingStyleStepHref(requestedDestination)
  }
  return requestedDestination
}
