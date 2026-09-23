// Safety 2 — public surface of the pure classifier module (Checkpoint
// 1). Everything server-side that needs to CLASSIFY content should
// import from here, not reach into individual files directly — this
// is the "one reusable classification interface" spec §6 asks for.
//
// Deliberately narrow: this is the production-facing Safety policy
// interface, not a grab-bag of every helper this module happens to
// contain. ClassificationResult itself already excludes raw extracted
// indicators (emails, phone numbers, URLs, wallet addresses) — a
// classification consumer needs the DECISION, never the private
// evidence that produced it (see classify.ts's ClassificationResult
// doc comment). normalize.ts/indicators.ts stay internal to this
// module; their own test files import them directly, which is fine —
// a test exercising internals is not the same thing as an application
// depending on them.
export { classifyContent, combineClassifications, type ClassificationResult } from './classify'
export {
  CONTENT_REASON_CODES,
  BEHAVIORAL_REASON_CODES,
  IMAGE_REASON_CODES,
  REASON_CODES,
  type ContentReasonCode,
  type BehavioralReasonCode,
  type ImageReasonCode,
  type ReasonCode,
  type RiskBand,
  type MutationDisposition,
} from './reason-codes'
