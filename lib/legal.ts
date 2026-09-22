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

// Public launch legal/safety pages (/terms, /privacy,
// /community-guidelines, /safety) — Staggar Ltd is the confirmed legal
// operator of Tempa. These are the exact confirmed launch facts, kept
// in this one file so the four pages (and their tests) share a single
// source rather than each hardcoding its own copy of the same strings.
//
// Deliberately limited to what was actually confirmed for launch: no
// jurisdiction, registration-classification, or data-protection-officer
// / representative conclusions (e.g. Nigerian DCPMI, EU/UK DPO, EU
// Article 27 or UK representative status) are stated, implied, or
// derived anywhere in this file or the pages that use it — those
// remain deliberately out of scope for this checkpoint.
export const OPERATOR_NAME = 'Staggar Ltd'

export const OPERATOR_ADDRESS_LINES = [
  'No. 14, Favour Davis Street',
  'Banky Peace Heights Estate',
  'Magboro, Ogun State',
  'Nigeria',
] as const

export const LEGAL_EFFECTIVE_DATE = 'September 28, 2026'

export const SUPPORT_EMAIL = 'support@jointempa.com'
export const SAFETY_EMAIL = 'safety@jointempa.com'
export const PRIVACY_EMAIL = 'privacy@jointempa.com'
export const LEGAL_EMAIL = 'legal@jointempa.com'
