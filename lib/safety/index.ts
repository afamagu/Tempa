// Safety 2 — public surface of the pure classifier module (Checkpoint
// 1). Everything server-side that needs to classify content should
// import from here, not reach into individual files directly — this
// is the "one reusable classification interface" spec §6 asks for.

export { classifyContent, type ClassificationResult } from './classify'
export { extractIndicators, type ExtractedIndicators, type MoneyAmount } from './indicators'
export { toDisplayText, toCanonicalText, toNumericText } from './normalize'
export {
  CONTENT_REASON_CODES,
  BEHAVIORAL_REASON_CODES,
  IMAGE_REASON_CODES,
  REASON_CODES,
  maxRiskBand,
  riskBandAtLeast,
  type ContentReasonCode,
  type BehavioralReasonCode,
  type ImageReasonCode,
  type ReasonCode,
  type RiskBand,
  type MutationDisposition,
} from './reason-codes'
