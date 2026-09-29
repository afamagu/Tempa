// Adult Eligibility + Legal Acceptance Gate — the ONE central source
// for which legal-document versions are currently required. Every place
// that needs to know whether a member's acceptance is current imports
// these constants rather than hardcoding a version.
//
// EMERGENCY LOGIN HOTFIX (2026-09-29): production's
// accept_current_legal_documents() RPC still records launch-v1. The
// application briefly moved this constant to launch-v2 before the matching
// SQL function update was applied, which trapped returning members in a
// /begin acceptance loop: the RPC succeeded, wrote v1, router.refresh()
// then correctly found v2 still missing. Keep the enforced version aligned
// with the live server authority until the prepared v2 legal-acceptance
// migration is applied. Do not bump this constant ahead of that migration.
export const CURRENT_TERMS_VERSION = '2026-09-launch-v1'
export const CURRENT_COMMUNITY_GUIDELINES_VERSION = '2026-09-launch-v1'

export type LegalDocumentType = 'terms_of_service' | 'community_guidelines'

export type LegalAcceptanceRecord = {
  documentType: LegalDocumentType
  documentVersion: string
}

export function isLegalCurrent(acceptances: LegalAcceptanceRecord[]): boolean {
  const hasCurrentTerms = acceptances.some(
    (a) => a.documentType === 'terms_of_service' && a.documentVersion === CURRENT_TERMS_VERSION
  )
  const hasCurrentCommunityGuidelines = acceptances.some(
    (a) => a.documentType === 'community_guidelines' && a.documentVersion === CURRENT_COMMUNITY_GUIDELINES_VERSION
  )
  return hasCurrentTerms && hasCurrentCommunityGuidelines
}

export const OPERATOR_NAME = 'Staggar Ltd'

export const OPERATOR_ADDRESS_LINES = [
  'No. 14, Favour Davis Street',
  'Banky Peace Heights Estate',
  'Magboro, Ogun State',
  'Nigeria',
] as const

export const LEGAL_EFFECTIVE_DATE = 'September 29, 2026'

export const SUPPORT_EMAIL = 'support@jointempa.com'
export const SAFETY_EMAIL = 'safety@jointempa.com'
export const PRIVACY_EMAIL = 'privacy@jointempa.com'
export const LEGAL_EMAIL = 'legal@jointempa.com'
