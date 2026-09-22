import { resolveOnboardingDestination, type OnboardingStage } from '@/lib/onboarding'

// Adult Eligibility + Legal Acceptance Gate — the ONE account-entry
// routing decision, layered ABOVE the existing profile-onboarding
// resolver (lib/onboarding.ts), which is left completely untouched and
// continues to own the `mark | question | complete` sequence exactly
// as before. This module never adds a value to onboarding_stage —
// eligibility/legal state lives entirely in its own tables
// (account_eligibility, legal_acceptances; see docs/sql/2026-09-21-
// adult-eligibility-and-legal-acceptance.sql), never in profiles.
//
// Pure and DOM/DB-free by design (the same "extract pure logic for
// testability" convention lib/onboarding.ts itself established) — the
// three call sites that actually fetch this state (proxy.ts,
// app/auth/callback/route.ts, app/begin/page.tsx) each run their own
// small Supabase query and hand the result to this function, matching
// how those same three files already call resolveOnboardingDestination
// today rather than sharing one data-fetching helper.

export type EligibilityStatus = 'eligible' | 'ineligible' | 'review_required'

export type AccountEntryState = {
  authenticated: boolean
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
}

/**
 * Conceptual routing (see this checkpoint's own implementation report
 * for the full sequence diagram):
 *
 *   unauthenticated                              -> /sign-in
 *   authenticated, no eligibility state yet       -> /begin
 *   authenticated, ineligible (still blocked)     -> /begin (terminal)
 *   authenticated, under manual review             -> /begin (terminal)
 *   eligible, required legal acceptance missing   -> /begin
 *   eligible, legally current, no profile         -> /profile
 *   eligible, legally current, profile stage mark -> /profile/mark
 *   eligible, legally current, profile stage question -> /profile/question
 *   eligible, legally current, profile complete   -> requestedDestination
 *
 * `/begin` itself decides WHICH of its own internal states to render
 * (DOB form / ineligible terminal / review terminal / legal
 * acceptance) — this function only ever decides whether to send the
 * member there at all, never which sub-state.
 */
export function resolveAccountEntryDestination(state: AccountEntryState, requestedDestination: string): string {
  if (!state.authenticated) return '/sign-in'

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
    },
    requestedDestination
  )
}
