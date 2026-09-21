// Adult Eligibility + Legal Acceptance Gate — the ONE central source
// for which legal-document versions are currently required. Every
// place that needs to know "is this member's acceptance current" (the
// /begin route, the account-entry resolver, proxy.ts, auth/callback)
// imports these constants rather than re-deriving or hardcoding a
// version string of its own.
//
// IMPORTANT — PRELAUNCH: the legal documents themselves are still
// undergoing their final prelaunch freeze. These constants are
// deliberately trivial to update in exactly one place. If the final
// Terms of Service or Community Guidelines text changes materially
// before launch, bump the corresponding version string below BEFORE
// any real member acceptance is collected against it — a version bump
// does not retroactively invalidate already-recorded acceptances of an
// OLDER version (see legal_acceptances' own (user_id, document_type,
// document_version) uniqueness in the SQL migration); it simply means
// every member who already accepted the old version will be asked to
// accept the new one the next time they hit /begin's gate.

export const CURRENT_TERMS_VERSION = '2026-09-launch-v1'
export const CURRENT_COMMUNITY_GUIDELINES_VERSION = '2026-09-launch-v1'

export type LegalDocumentType = 'terms_of_service' | 'community_guidelines'

export type LegalAcceptanceRecord = {
  documentType: LegalDocumentType
  documentVersion: string
}

/**
 * True only when BOTH currently-required documents have been accepted
 * at their CURRENT version — an acceptance of an older version of
 * either document does not count, by design (this is exactly what lets
 * a future version bump require reacceptance without touching profile
 * onboarding or eligibility at all).
 */
export function isLegalCurrent(acceptances: LegalAcceptanceRecord[]): boolean {
  const hasCurrentTerms = acceptances.some(
    (a) => a.documentType === 'terms_of_service' && a.documentVersion === CURRENT_TERMS_VERSION
  )
  const hasCurrentCommunityGuidelines = acceptances.some(
    (a) => a.documentType === 'community_guidelines' && a.documentVersion === CURRENT_COMMUNITY_GUIDELINES_VERSION
  )
  return hasCurrentTerms && hasCurrentCommunityGuidelines
}
