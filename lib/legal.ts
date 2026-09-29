// Adult Eligibility + Legal Acceptance Gate — the ONE central source
// for which legal-document versions are currently required. Every place
// that needs to know whether a member's acceptance is current imports
// these constants rather than hardcoding a version.
//
// September 29 v2 adds the open-web Dispatch publication model: new
// Dispatches default to Public on the web with a visible author control
// and a Preview reminder. This is a material Terms change, so v1
// acceptance is not silently carried forward.
export const CURRENT_TERMS_VERSION = '2026-09-launch-v2'
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
