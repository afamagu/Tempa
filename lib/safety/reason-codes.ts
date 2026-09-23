// Safety 2 — Scam, Abuse & Account Risk. The signal/reason-code
// taxonomy. A reason code is evidence for review, never a factual
// declaration about someone's character or intent — this module only
// defines the vocabulary; lib/safety/classify.ts decides when a code
// actually fires from content, and the deterministic behavioral engine
// (Checkpoint 5 — tempa_private.evaluate_behavior, docs/sql/2026-10-03-
// safety-persistence.sql's own Part 6B) decides when the BEHAVIORAL
// codes fire from account activity. Nothing here stores or implies
// "SCAMMER = TRUE".

/** Codes classify.ts (Checkpoint 1) can actually produce from a single
 * piece of text. There is deliberately no umbrella "FINANCIAL_
 * SOLICITATION" code here — every fired signal must be one of these
 * concrete, independently-meaningful subtypes, so compounding logic
 * never double-counts one detection as two signals (a generic
 * umbrella emitted alongside its own specific code) and evidence
 * shown to a reviewer is always specific enough to act on. Add an
 * umbrella value only when a real caller needs one to group/display
 * these, and keep it out of compounding either way. */
export const CONTENT_REASON_CODES = [
  'DIRECT_MONEY_REQUEST',
  'LOAN_OR_BILL_REQUEST',
  'PAYMENT_DETAILS',
  'CRYPTO_SOLICITATION',
  'INVESTMENT_SOLICITATION',
  'GIFT_CARD_REQUEST',
  'EMERGENCY_MONEY_REQUEST',
  'OFF_PLATFORM_ESCALATION',
  'SUSPICIOUS_LINK',
  'PHISHING_SIGNAL',
] as const

/** Codes reserved for the behavioral engine (Checkpoint 5) — account-
 * and correspondence-level aggregates, never derivable from one
 * message in isolation. Defined here now so the taxonomy is complete
 * and stable; classify.ts never emits these. */
export const BEHAVIORAL_REASON_CODES = [
  'REPEATED_SOLICITATION',
  'MASS_FIRST_CONTACT',
  'NEAR_DUPLICATE_OUTREACH',
  'HIGH_CONTACT_VELOCITY',
  'REPORT_SPIKE',
  'BLOCK_SPIKE',
  'ACCOUNT_VELOCITY',
] as const

/** Codes reserved for the image/OCR pipeline (Checkpoint 6). Defined
 * now for taxonomy completeness; not produced by this checkpoint. */
export const IMAGE_REASON_CODES = ['IMAGE_TEXT_FINANCIAL_SIGNAL', 'IMAGE_TEXT_PAYMENT_DETAILS'] as const

export const REASON_CODES = [...CONTENT_REASON_CODES, ...BEHAVIORAL_REASON_CODES, ...IMAGE_REASON_CODES] as const

export type ContentReasonCode = (typeof CONTENT_REASON_CODES)[number]
export type BehavioralReasonCode = (typeof BEHAVIORAL_REASON_CODES)[number]
export type ImageReasonCode = (typeof IMAGE_REASON_CODES)[number]
export type ReasonCode = (typeof REASON_CODES)[number]

/** Underlying severity of what was detected — independent of what
 * happens to the mutation (see MutationDisposition). 'none' produces
 * no signal at all; 'weak' MAY optionally produce one (spec §4's own
 * wording); 'meaningful' and above always do. */
export type RiskBand = 'none' | 'weak' | 'meaningful' | 'high' | 'severe'

/** What happens to the member's actual send/publish action. Kept
 * strictly separate from RiskBand — a 'high' risk event can still be
 * 'allow' (content proceeds) while escalating a case for review; only
 * 'severe' content classification maps to 'deny' by default. */
export type MutationDisposition = 'allow' | 'warn' | 'deny'

const RISK_BAND_ORDER: Record<RiskBand, number> = { none: 0, weak: 1, meaningful: 2, high: 3, severe: 4 }

export function maxRiskBand(a: RiskBand, b: RiskBand): RiskBand {
  return RISK_BAND_ORDER[a] >= RISK_BAND_ORDER[b] ? a : b
}

export function riskBandAtLeast(band: RiskBand, threshold: RiskBand): boolean {
  return RISK_BAND_ORDER[band] >= RISK_BAND_ORDER[threshold]
}
