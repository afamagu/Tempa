// Safety 2, Checkpoint 6 — image-text Safety / OCR architecture.
//
// SCOPE (deliberately narrow, per the approved checkpoint): detect
// scam/financial-solicitation TEXT embedded inside a user-uploaded
// Photo Moment, without ever creating a permanent OCR transcript of a
// private image. This is explicitly NOT nudity/face/identity/object/
// age/biometric detection, and NOT general image moderation — those
// stay out of Safety 2 entirely, per this checkpoint's own boundary.
//
// READ-ONLY AUDIT FINDINGS (performed before writing any of this file):
//   - Every Photo Moment (private Letters: lib/image-processing.ts +
//     app/letters/[letterId]/moments-composer.tsx; Dispatches: app/
//     board/dispatch-composer.tsx) is re-encoded to JPEG, EXIF-stripped,
//     and resized client-side (max 1600px, quality 0.85), then uploaded
//     to a PRIVATE Supabase Storage bucket ('letter-photos' or
//     'dispatch-photos', both `public: false`) BEFORE the Letter/
//     Dispatch is ever sent/published — the same "upload-before-send"
//     architecture item 7 asks this module to respect. Storage RLS
//     scopes read/insert to the correspondence's own two participants
//     (letter-photos) or the authenticated uploader (dispatch-photos);
//     there is no UPDATE/DELETE storage policy at all — once uploaded,
//     an image path is immutable, matching moments.image_path/dispatch_
//     moments.image_path's own immutability once attached.
//   - A Moment becomes associated with its Letter/Dispatch only at the
//     actual mutation (write_letter/reply_to_letter/publish_dispatch/
//     update_dispatch's own p_moments jsonb — first_letter, dispatch_
//     reply, and question_answer structurally have NO Moments param at
//     all, so image-text Safety is only ever relevant to those four
//     surfaces): the client holds `{position, imagePath, previewUrl}`
//     locally until Send/Publish, then submits `{position, image_path}`
//     pairs; the server never re-derives them from anything else.
//   - Curated Tempa Postcard artwork (public.postcard_catalog/
//     postcard_versions, docs/sql/2026-09-25-dispatch-postcards.sql) is
//     admin-authored, has no member upload path at all, and is
//     correctly NOT an OCR target — confirmed by inspecting its own
//     schema/grants (no insert policy for any client role).
//   - No OCR/image-text-extraction dependency exists anywhere in this
//     repo today (package.json has zero image/OCR packages).
//
// LOCAL/ON-DEVICE OCR DECISION (item 4): DEFERRED for this checkpoint.
// The only realistic dependency-free-of-a-native-binary candidate is
// tesseract.js (WASM Tesseract) — the sole meaningful implementation
// option evaluated. It was NOT added, because:
//   - Its WASM core plus even one language's trained data is several
//     megabytes, downloaded/cached at runtime — a real, unavoidable
//     bundle/network cost this lean app (zero existing heavy
//     dependencies; see package.json) does not currently carry anywhere.
//   - OCR is genuinely CPU-heavy; run in-browser (the only place a
//     private image's bytes are available without sending them to a
//     server — see the privacy boundary below) it can take several
//     seconds on an ordinary mobile device, exactly the "mobile impact"
//     and "uploads/sends becoming unreliable" risk item 4 asks to be
//     weighed explicitly, and item 8 explicitly warns against risking
//     ("every legitimate message blocked because a CPU-heavy OCR
//     dependency timed out").
//   - Run server-side instead, it would need to fetch each private
//     image from Storage into a request-scoped Route Handler (Vercel/
//     Node serverless execution: bounded execution time and memory,
//     no guaranteed persistent local cache for language data between
//     invocations) — a real, separate operational evaluation (cold-
//     start latency, timeout risk, per-invocation trained-data fetch
//     cost) that deserves its own dedicated engineering spike measured
//     against this app's actual traffic, not a decision folded silently
//     into a Safety architecture checkpoint.
// This is an explicit, reported DEFERRAL, not a silent gap: real
// extraction can be implemented later purely by replacing THIS file's
// extractImageSafetyText body — the caller contract and the classifier
// integration (classifyImageText below) are already built and tested
// against the full three-state contract now, ready for that body to be
// replaced with no other caller changing.
//
// FINGERPRINT/MUTATION BINDING (item 7) — DESIGNED, NOT YET WIRED:
// "Do not pretend an image was checked if the member can switch the
// image afterward" only has a live consequence once real image-text
// evidence can actually clear a Safety evaluation — which cannot happen
// yet, since extractImageSafetyText above always returns 'unavailable'.
// Wiring the binding now would mean touching three already-approved,
// heavily-tested core functions (tempa_private.safety_fingerprint,
// public.record_safety_evaluation, tempa_private.consume_safety_
// evaluation — docs/sql/2026-10-03-safety-persistence.sql) purely for a
// literal no-op (the value they'd bind is a jsonb array no live caller
// yet produces), for zero present benefit and real regression surface
// against every existing Checkpoint 3/4/5 migration test. Per this
// checkpoint's own explicit allowance to defer real execution rather
// than "fake OCR," the wiring is designed here precisely, deferred to
// land alongside a real OCR engine (at which point it becomes load-
// bearing and end-to-end testable), not implemented now:
//   - IDENTITY: moments.image_path / dispatch_moments.image_path (a
//     fresh crypto.randomUUID() per upload — see the audit above) is
//     already the correct immutable binding on its own; no raw image
//     BYTES need hashing in the browser "merely for ceremony" (item 7's
//     own wording) — the storage path itself already changes if and
//     only if the actual image changes, matching every overwrite/upsert
//     rule already inspected (no UPDATE storage policy exists at all).
//   - REPRESENTATION: the four surfaces that carry Moments (write_
//     anytime, reply, dispatch_publish, dispatch_update — first_letter/
//     dispatch_reply/question_answer structurally have no Moments
//     param) would serialize their own received p_moments the SAME
//     length-prefixed deterministic way topics already are inside
//     tempa_private.safety_fingerprint — sorted by position, each entry
//     as `position:length:image_path`, joined with `|`.
//   - BINDING POINT: safety_fingerprint gains one new TRAILING
//     parameter, `p_moments jsonb default null` — trailing so every
//     existing positional caller (record_behavior_signal, and the four
//     Moments-carrying mutation RPCs once they pass their own p_moments
//     through consume_safety_evaluation) keeps compiling/resolving
//     unchanged until each is deliberately updated to pass a real
//     value; record_safety_evaluation and consume_safety_evaluation
//     each gain the same trailing param, threaded straight through to
//     the fingerprint call already inside both.
//   - INVALIDATION: once wired, this reuses the EXISTING "different
//     fingerprint = must re-evaluate" mechanism unchanged — no new
//     comparison logic, no new column. Adding/removing/reordering/
//     swapping a bound image changes the serialized string, which
//     changes the fingerprint, which consume_safety_evaluation's
//     existing recheck already rejects.
//   - Preserves every existing Moment ownership check untouched (each
//     mutation RPC's own `auth.uid()::text = (storage.foldername(...))
//     [1]` validation stays exactly as-is; this binding only affects
//     Safety clearance matching, never upload authorization).

import { classifyContent, type ClassificationResult } from './classify'
import type { ImageReasonCode } from './reason-codes'

/** The one OCR adapter boundary (item 5). Every future real
 * implementation (local/on-device, or a dedicated first-party service
 * with its own separately-reviewed privacy/DPA/retention decision —
 * never a general-purpose external LLM/API, see this module's own
 * privacy-boundary note below) satisfies this exact three-state
 * contract; no caller anywhere needs to change when one lands. */
export type ImageOcrResult =
  | { status: 'text_found'; text: string }
  | { status: 'no_text' }
  | { status: 'unavailable'; reason: string }

/**
 * Extracts Safety-relevant text from a user-uploaded Photo Moment
 * image, or reports why it could not. NEVER logs, persists, or returns
 * the extracted text anywhere beyond this one call's own return value
 * — a caller that wants a Safety verdict must immediately hand
 * `text_found`'s own `text` to classifyImageText below and discard the
 * raw string; nothing in this module writes it to a log, an analytics
 * event, or any table. PERSISTENCE (item 9): no new table/column exists
 * or is needed for this checkpoint — classifyImageText's own output is
 * an ordinary ClassificationResult, combined via the EXISTING
 * combineClassifications the same way a Postcard's Reveal Line/back
 * message already are, so once real extraction lands, its reason codes
 * flow into the EXISTING safety_signals.reason_codes (already an
 * unconstrained text[], no enumerated CHECK — see lib/__tests__/
 * safetyPersistenceMigration.test.ts's own "taxonomy lives in
 * TypeScript" test) with zero schema change. No raw OCR text is ever a
 * candidate for storage anywhere in this design.
 *
 * PRIVACY BOUNDARY (item 3, absolute): whatever engine eventually backs
 * this function, it must never send the private image bytes OR any
 * extracted text to a general-purpose external LLM/API (OpenAI/Claude/
 * Gemini/etc.) — a private Letter or Dispatch Photo Moment is not
 * content this app may forward to a third party for "analysis." A
 * narrow, purpose-built, deterministic OCR engine (local/on-device, or
 * a dedicated OCR-only first-party service with its own separately
 * reviewed privacy/DPA/retention decision) is the only category of
 * implementation this function may ever call.
 *
 * Currently ALWAYS returns 'unavailable' — see this module's own header
 * for the concrete, reported reason no local OCR engine is bundled yet.
 * This is the deliberate, explicit "do not fake OCR" state item 4/8
 * both require: never invents `text_found`/`no_text` when no real
 * extraction ran, so a caller can never mistake "we didn't check" for
 * "we checked and it was clean."
 */
// The parameter documents the real call shape a future implementation
// will receive (a stable storage path, or the raw Blob a client-side
// engine would decode) even though today's stub body never reads it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function extractImageSafetyText(image: { path: string } | Blob): Promise<ImageOcrResult> {
  return { status: 'unavailable', reason: 'ocr_not_implemented' }
}

// The financial-solicitation-family CONTENT_REASON_CODES considered
// in-scope for image text (mirrors tempa_private.solicitation_
// reason_codes, docs/sql/2026-10-03-safety-persistence.sql's own
// Checkpoint 5 helper — same family, reused rather than re-derived a
// second time) — everything a directed money/crypto/investment/gift-
// card/emergency/off-platform ask can look like.
const IMAGE_FINANCIAL_FAMILY = [
  'DIRECT_MONEY_REQUEST',
  'LOAN_OR_BILL_REQUEST',
  'CRYPTO_SOLICITATION',
  'INVESTMENT_SOLICITATION',
  'GIFT_CARD_REQUEST',
  'EMERGENCY_MONEY_REQUEST',
  'OFF_PLATFORM_ESCALATION',
] as const

/**
 * Feeds extracted image text through the EXISTING deterministic
 * classifier (classifyContent — item 5's own "do not create an image-
 * specific second scam classifier") and remaps its result onto the two
 * reserved image reason codes (lib/safety/reason-codes.ts's own
 * IMAGE_REASON_CODES, defined since Checkpoint 1 and unchanged here —
 * "inspect the existing taxonomy before changing it; do not duplicate
 * synonyms"):
 *   - IMAGE_TEXT_PAYMENT_DETAILS when classifyContent's own PAYMENT_
 *     DETAILS rule fired (bank/IBAN/payment-handle disclosure).
 *   - IMAGE_TEXT_FINANCIAL_SIGNAL when any other financial-
 *     solicitation-family code fired (see IMAGE_FINANCIAL_FAMILY).
 * The classifier's own riskBand/mutationDisposition/escalateCase are
 * preserved EXACTLY as classifyContent produced them — this function
 * only relabels WHICH reason codes surface, never re-derives severity,
 * so image-sourced evidence gets the identical policy treatment
 * written text already does.
 *
 * Deliberately out of THIS checkpoint's narrow scope: a code that fired
 * with NO financial-family/payment code alongside it (e.g. a bare
 * SUSPICIOUS_LINK or PHISHING_SIGNAL in an image, no money ask) is
 * dropped entirely — this checkpoint is "scam/financial-solicitation
 * text," never general image-link moderation; returns the same neutral
 * 'none'/'allow' shape as no text having been found at all.
 */
export function classifyImageText(text: string): ClassificationResult {
  const result = classifyContent(text)

  const hasPaymentDetails = result.reasonCodes.includes('PAYMENT_DETAILS')
  const hasFinancialFamily = result.reasonCodes.some((code) =>
    (IMAGE_FINANCIAL_FAMILY as readonly string[]).includes(code)
  )

  if (!hasPaymentDetails && !hasFinancialFamily) {
    return { riskBand: 'none', reasonCodes: [], mutationDisposition: 'allow', escalateCase: false }
  }

  const imageReasonCodes: ImageReasonCode[] = []
  if (hasFinancialFamily) imageReasonCodes.push('IMAGE_TEXT_FINANCIAL_SIGNAL')
  if (hasPaymentDetails) imageReasonCodes.push('IMAGE_TEXT_PAYMENT_DETAILS')

  return {
    riskBand: result.riskBand,
    reasonCodes: imageReasonCodes,
    mutationDisposition: result.mutationDisposition,
    escalateCase: result.escalateCase,
  }
}
