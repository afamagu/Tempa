import { resolveOnboardingDestination, type OnboardingStage } from '@/lib/onboarding'

// Adult Eligibility + Legal Acceptance Gate — the ONE account-entry
// routing decision, layered ABOVE the existing profile-onboarding
// resolver (lib/onboarding.ts). Language confirmation now sits first in
// this sequence because a member must be able to understand every later
// setup screen before DOB/legal/profile onboarding begins.

export type EligibilityStatus = 'eligible' | 'ineligible' | 'review_required'

export const LANGUAGE_ONBOARDING_PATH = '/language'

export type AccountEntryState = {
  authenticated: boolean
  /** false = the new language-first gate is installed and this member has
   * not confirmed a Tempa language yet. undefined is deliberately fail-open
   * for deploy ordering before the language-onboarding migration is applied. */
  languageConfirmed?: boolean
  /** null = no eligibility row exists yet (brand-new account, or an
   * existing member who predates this checkpoint). */
  eligibilityStatus: EligibilityStatus | null
  /** Only meaningful when eligibilityStatus === 'ineligible' — the
   * calendar date on or after which a fresh, neutral DOB screening is
   * allowed again. null otherwise. */
  eligibleOn: string | null
  /** True only when the CURRENT required Terms AND Community
   * Guidelines versions have both been accepted (lib/legal.ts's
   * isLegalCurrent) — irrelevant/ignored when not yet eligible. */
  legalCurrent: boolean
  hasProfile: boolean
  onboardingStage: OnboardingStage | null
  /** See lib/onboarding.ts — optional; only the proxy's entry-state read
   * supplies it. */
  needsWritingStyle?: boolean
}

/**
 * Conceptual routing:
 *
 *   unauthenticated                               -> /sign-in
 *   authenticated, language not confirmed        -> /language
 *   authenticated, no eligibility state yet      -> /begin
 *   authenticated, ineligible / review           -> /begin
 *   eligible, legal acceptance missing           -> /begin
 *   eligible, legally current, no profile        -> /profile
 *   profile stage mark                           -> /profile/mark
 *   profile stage question                       -> /profile/question
 *   profile complete                             -> requestedDestination
 *
 * A direct visit to /language by an unconfirmed member is allowed to render
 * that gate itself. Once language is confirmed, the /language page performs
 * its own redirect into the ordinary account-entry sequence.
 */
export function resolveAccountEntryDestination(state: AccountEntryState, requestedDestination: string): string {
  if (!state.authenticated) return '/sign-in'

  if (state.languageConfirmed === false) return LANGUAGE_ONBOARDING_PATH

  if (state.eligibilityStatus === null) return '/begin'
  if (state.eligibilityStatus === 'ineligible') return '/begin'
  if (state.eligibilityStatus === 'review_required') return '/begin'

  // state.eligibilityStatus === 'eligible' from here on.
  if (!state.legalCurrent) return '/begin'

  return resolveOnboardingDestination(
    {
      authenticated: state.authenticated,
      hasProfile: state.hasProfile,
      onboardingStage: state.onboardingStage,
      needsWritingStyle: state.needsWritingStyle,
    },
    requestedDestination
  )
}
