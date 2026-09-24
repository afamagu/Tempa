// Safety 2 — the context classifier. Combines structured indicators
// (lib/safety/indicators.ts) into a risk band, reason codes, and a
// mutation-disposition recommendation.
//
// IMPORTANT — authority boundary: this module is the CANONICAL
// classifier (per the approved Safety 2 architecture), but it is only
// ever authoritative when run server-side, inside the /api/safety/
// evaluate Route Handler, over content the caller cannot tamper with
// after the fact — the database never re-implements this logic; it
// only verifies (via a content fingerprint) that THIS classifier
// already evaluated the exact content being submitted. See the
// Checkpoint 2/3 design notes for the full trust boundary. Running
// this function directly is safe and pure (no I/O), which is what
// makes it possible to unit-test exhaustively here, in Checkpoint 1,
// with no database or network involved.
//
// Design principle (spec §3): context + behavior, not forbidden
// vocabulary. A bare mention of money/crypto/gift-cards/rent is never
// enough on its own — what matters is whether the message contains a
// request DIRECTED at the recipient to move money/value, optionally
// compounded by urgency, off-platform escalation, or unambiguous
// payment mechanics (an actual crypto address, explicit gift-card-code
// requests, shared bank details).

import { extractIndicators, type ExtractedIndicators } from './indicators'
import { detectContactSharing } from './patterns'
import {
  maxRiskBand,
  riskBandAtLeast,
  type ContentReasonCode,
  type MutationDisposition,
  type ReasonCode,
  type RiskBand,
} from './reason-codes'

export type ClassificationResult = {
  riskBand: RiskBand
  // Checkpoint 6 — widened from ContentReasonCode[] to the full
  // ReasonCode[] union (backward compatible: ContentReasonCode is
  // already a subset) so combineClassifications can also accept a
  // classifyImageText result (lib/safety/image-ocr.ts), whose reason
  // codes are the reserved IMAGE_TEXT_FINANCIAL_SIGNAL/IMAGE_TEXT_
  // PAYMENT_DETAILS — never a behavioral code, which this module's own
  // classifyContent/classifyImageText still never produce.
  reasonCodes: ReasonCode[]
  mutationDisposition: MutationDisposition
  /** Whether this evaluation should open/update a Needs Attention
   * case, independent of whether the mutation itself is allowed. */
  escalateCase: boolean
}

/** risk_band, mutation_disposition, and escalate_case are three
 * genuinely independent axes (not one value with two aliases): a rule
 * can classify content as high severity while still choosing to allow
 * it and escalate a case for quiet human review (see the
 * hasBankDetailsSharedPhrase rule below), or vice versa. `policy`
 * overrides ONE OR BOTH enforcement axes for this specific rule; any
 * axis left unset falls back to the band's own default (see
 * defaultDispositionForBand/defaultEscalateForBand). Compounding never
 * bypasses this — see the end of classifyContent. */
type PolicyOverride = { disposition?: MutationDisposition; escalate?: boolean }

type Rule = {
  reasonCode: ContentReasonCode
  band: RiskBand
  fires: (i: ExtractedIndicators) => boolean
  policy?: PolicyOverride
}

// Each rule is independently testable and independently extensible —
// per spec §6, "one reusable classification interface" rather than
// scattered per-surface logic. Order doesn't matter; every matching
// rule contributes its reason code and its band is combined via max().
// Every `fires` below combines only the LOCALLY-BOUND composite
// indicators from indicators.ts (hasDirected*/has*Request/
// has*LinkedUrl/...) — never raw message-wide fields like
// moneyAmounts, cryptoAddresses, hasCryptoKeyword, hasEmergencyKeyword,
// hasPaymentHandleKeyword, or urls directly. A long letter can contain
// several unrelated topics; ANDing raw per-message facts together
// would manufacture relationships between them that were never
// actually there (see indicators.ts's own "LOCALITY PRINCIPLE" header
// comment for the worked examples this guards against).
// Locked policy: an ACTUAL request directed at the recipient to provide
// money/value is denied — whichever detector path finds it (the
// compositional Pattern Library below, or the older locality-bound
// phrase paths). A statement of hardship with no ask is not a request
// and never reaches these rules (see indicators.ts).
const DENY: PolicyOverride = { disposition: 'deny' }

const RULES: Rule[] = [
  {
    reasonCode: 'DIRECT_MONEY_REQUEST',
    band: 'meaningful',
    fires: (i) => i.hasDirectedMoneyRequest && !i.hasDirectedCryptoRequest && !i.hasDirectedGiftCardRequest,
    policy: DENY,
  },
  {
    // A directed request WITH an explicit amount LOCALLY tied to it is
    // more concrete than a bare request — bumped to 'high'.
    reasonCode: 'DIRECT_MONEY_REQUEST',
    band: 'high',
    fires: (i) => i.hasDirectedMoneyRequestWithAmount,
    policy: DENY,
  },
  {
    reasonCode: 'LOAN_OR_BILL_REQUEST',
    band: 'meaningful',
    fires: (i) => i.hasLoanOrBillRequestPhrase,
    policy: DENY,
  },
  {
    // A crypto keyword alone ("my Ethereum wallet address is 0x...")
    // is a topic/disclosure, not a solicitation — this requires the
    // SAME request to be crypto-flavored (hasDirectedCryptoRequest
    // already covers "send USDT to 0x..." via the transfer-verb+
    // address check in indicators.ts).
    reasonCode: 'CRYPTO_SOLICITATION',
    band: 'high',
    fires: (i) => i.hasDirectedCryptoRequest,
    policy: DENY,
  },
  {
    // An address being SOLICITED (tied to the SAME directed request) is
    // unambiguous. An address merely being STATED, with no request
    // attached ("my wallet address is 0x...", "this article uses 0x...
    // as an example"), is not — a bare address+keyword co-occurrence is
    // not enough for 'severe' by itself.
    reasonCode: 'CRYPTO_SOLICITATION',
    band: 'severe',
    fires: (i) => i.hasDirectedCryptoTransfer,
  },
  {
    reasonCode: 'INVESTMENT_SOLICITATION',
    band: 'high',
    fires: (i) => i.hasInvestmentPromiseLanguage,
    policy: DENY,
  },
  {
    // Explicit pitch/proposition language ("forex opportunity", "show
    // you the investment") — see hasInvestmentPitchContext's own doc
    // comment in indicators.ts for why this replaced a "topic word +
    // off-platform mention in the same sentence" check (punctuation-
    // dependent and too easily satisfied by two unrelated asides).
    reasonCode: 'INVESTMENT_SOLICITATION',
    band: 'high',
    fires: (i) => i.hasInvestmentPitchContext,
    policy: DENY,
  },
  {
    reasonCode: 'GIFT_CARD_REQUEST',
    band: 'meaningful',
    fires: (i) => i.hasDirectedGiftCardRequest,
    policy: DENY,
  },
  {
    // "Buy a Steam gift card and send me the code" — a narrow, highly
    // specific pattern with essentially no legitimate reading.
    reasonCode: 'GIFT_CARD_REQUEST',
    band: 'severe',
    fires: (i) => i.hasGiftCardCodeRequest,
  },
  {
    reasonCode: 'PAYMENT_DETAILS',
    band: 'high',
    fires: (i) => i.hasBankDetailsSharedPhrase,
    // An unprompted disclosure of one's OWN bank/IBAN details to a pen
    // pal is a real risk to the person who shared it (later targeting,
    // pressure, etc.) but it is their own information and their own
    // choice to share it — content-only detection isn't confident
    // enough to justify interrupting their letter over it. Escalate the
    // case so a human can look (and consider reaching out with a safety
    // tip) without auto-blocking. This is a genuine, deliberately-non-
    // default axis combination (high risk + allow + escalate).
    policy: { disposition: 'allow', escalate: true },
  },
  {
    reasonCode: 'PAYMENT_DETAILS',
    band: 'meaningful',
    fires: (i) => i.hasDirectedPaymentHandleRequest,
    policy: DENY,
  },
  {
    // Emergency VOCABULARY plus an incidental amount ("My hospital
    // bill was $500.", "The surgery cost us $2,000.") is a descriptive
    // statement, not a solicitation — this requires the emergency
    // vocabulary to be in the SAME sentence as an actual request for
    // money/payment/value (a directed money request or a genuine
    // bill/loan-help ask), not merely emergency words co-occurring
    // anywhere in the letter with an unrelated request or number.
    reasonCode: 'EMERGENCY_MONEY_REQUEST',
    band: 'high',
    fires: (i) => i.hasEmergencyFramedMoneyRequest,
    policy: DENY,
  },
  // ---- CONFIRMED financial solicitation (Phase 1 locked policy) ----
  // Financial solicitation is not allowed on Tempa, whatever the
  // relationship or claim. These rules are fed by the COMPOSITIONAL
  // Pattern Library (lib/safety/patterns/solicitation.ts): financial
  // need/value + a request directed at the recipient, not one magic
  // phrase. A confirmed solicitation is DENIED — there is no "send
  // anyway" — and the attempt is still recorded as evidence. The older
  // phrase-shaped rules above are ALSO denials (same policy, same DENY):
  // any detector path that finds a genuine ask is a confirmed one. No
  // financial solicitation falls back to a warning.
  {
    reasonCode: 'DIRECT_MONEY_REQUEST',
    band: 'meaningful',
    fires: (i) => i.solicitedMoney && !i.solicitedWithAmount,
    policy: DENY,
  },
  {
    // An amount tied to a confirmed ask is more concrete — 'high'
    // (which also opens/updates a review case).
    reasonCode: 'DIRECT_MONEY_REQUEST',
    band: 'high',
    fires: (i) => i.solicitedMoney && i.solicitedWithAmount,
    policy: DENY,
  },
  {
    reasonCode: 'LOAN_OR_BILL_REQUEST',
    band: 'meaningful',
    fires: (i) => i.solicitedBillOrLoan,
    policy: DENY,
  },
  {
    reasonCode: 'GIFT_CARD_REQUEST',
    band: 'high',
    fires: (i) => i.solicitedGiftCard,
    policy: DENY,
  },
  {
    reasonCode: 'CRYPTO_SOLICITATION',
    band: 'high',
    fires: (i) => i.solicitedCrypto,
    policy: DENY,
  },
  {
    reasonCode: 'PAYMENT_DETAILS',
    band: 'meaningful',
    fires: (i) => i.solicitedPaymentMethod,
    policy: DENY,
  },
  {
    reasonCode: 'MONEY_INTERMEDIARY_REQUEST',
    band: 'high',
    fires: (i) => i.solicitedIntermediary,
    policy: DENY,
  },
  {
    reasonCode: 'INVESTMENT_SOLICITATION',
    band: 'high',
    fires: (i) => i.solicitedInvestment,
    policy: DENY,
  },
  {
    reasonCode: 'OFF_PLATFORM_ESCALATION',
    band: 'weak',
    fires: (i) => i.hasOffPlatformKeyword,
  },
  {
    // Off-platform correlates with genuine solicitation shapes only,
    // in the SAME sentence: an actual directed money request, explicit
    // investment pitch language, or an explicit investment promise —
    // never a bare topic word or request co-occurring somewhere else
    // in the message (see hasOffPlatformSolicitation's doc comment in
    // indicators.ts).
    reasonCode: 'OFF_PLATFORM_ESCALATION',
    band: 'high',
    fires: (i) => i.hasOffPlatformSolicitation,
    policy: DENY,
  },
  {
    reasonCode: 'SUSPICIOUS_LINK',
    band: 'weak',
    fires: (i) => i.urls.length > 0,
  },
  {
    // A link next to emergency/hospital vocabulary is completely
    // ordinary ("This is the hospital website: https://...") — only a
    // directed money request in the SAME sentence as the link, or a
    // shortener alongside genuinely suspicious local context, upgrades
    // it to 'meaningful'. A shortener ALONE ("Here is the recipe:
    // https://bit.ly/example") stays 'weak'. Genuine phishing concern
    // is otherwise carried by PHISHING_SIGNAL's own rule below.
    reasonCode: 'SUSPICIOUS_LINK',
    band: 'meaningful',
    fires: (i) => i.hasSolicitationLinkedUrl || i.hasSuspiciousShortenerWithContext,
  },
  {
    reasonCode: 'PHISHING_SIGNAL',
    band: 'high',
    fires: (i) => i.hasPhishingLinkedUrl,
  },
]

const DISPOSITION_SEVERITY: Record<MutationDisposition, number> = { allow: 0, warn: 1, deny: 2 }

function moreRestrictiveDisposition(a: MutationDisposition, b: MutationDisposition): MutationDisposition {
  return DISPOSITION_SEVERITY[a] >= DISPOSITION_SEVERITY[b] ? a : b
}

/** Checkpoint 3 — combines several INDEPENDENTLY-produced
 * ClassificationResults (e.g. a Letter body classified separately from
 * its optional Postcard's Reveal Line/back message) into one, the same
 * deterministic way classifyContent's own RULES already combine with
 * each other: max risk band, union of reason codes, most-restrictive
 * disposition, OR'd escalateCase. Deliberately never concatenates the
 * SOURCE TEXTS first and classifies the result — that would invent
 * semantic proximity between fields that were never actually adjacent
 * (half a solicitation in the body and an unrelated half-sentence in a
 * Postcard would then read as one combined solicitation neither field
 * is on its own). Classifying each field separately and combining only
 * the STRUCTURED results means a complete solicitation entirely
 * contained in any ONE field still produces its own full, correct
 * classification, while two genuinely unrelated fragments in different
 * fields never manufacture a match that isn't really there. */
export function combineClassifications(results: ClassificationResult[]): ClassificationResult {
  let band: RiskBand = 'none'
  let disposition: MutationDisposition = 'allow'
  let escalateCase = false
  const reasonCodeSet = new Set<ReasonCode>()

  for (const result of results) {
    band = maxRiskBand(band, result.riskBand)
    disposition = moreRestrictiveDisposition(disposition, result.mutationDisposition)
    escalateCase = escalateCase || result.escalateCase
    for (const code of result.reasonCodes) reasonCodeSet.add(code)
  }

  return {
    riskBand: band,
    reasonCodes: Array.from(reasonCodeSet),
    mutationDisposition: disposition,
    escalateCase,
  }
}

/** The explicit POLICY layer's default for a band with no rule-level
 * override — never the only way a band maps to enforcement (see
 * PolicyOverride above), but always what compounding's own risk
 * increase passes through (see the end of classifyContent). */
function defaultDispositionForBand(band: RiskBand): MutationDisposition {
  if (band === 'severe') return 'deny'
  if (riskBandAtLeast(band, 'meaningful')) return 'warn'
  return 'allow'
}

function defaultEscalateForBand(band: RiskBand): boolean {
  return riskBandAtLeast(band, 'high')
}

export type ClassifyOptions = {
  /** The text is being written into a PRIVATE letter (first letter,
   * reply, write-anytime). Only then does personal-contact / off-
   * platform sharing produce a privacy-reminder interruption — on a
   * public surface it is neither expected nor this policy's concern. */
  privateLetter?: boolean
}

export function classifyContent(rawText: string, options: ClassifyOptions = {}): ClassificationResult {
  const indicators = extractIndicators(rawText)

  let band: RiskBand = 'none'
  let disposition: MutationDisposition = 'allow'
  let escalateCase = false
  const reasonCodeSet = new Set<ContentReasonCode>()

  for (const rule of RULES) {
    if (!rule.fires(indicators)) continue
    reasonCodeSet.add(rule.reasonCode)
    band = maxRiskBand(band, rule.band)
    disposition = moreRestrictiveDisposition(disposition, rule.policy?.disposition ?? defaultDispositionForBand(rule.band))
    escalateCase = escalateCase || (rule.policy?.escalate ?? defaultEscalateForBand(rule.band))
  }

  // Compounding: independently-fired distinct reason codes at
  // 'meaningful' or above, together, read as more concerning than any
  // one of them alone — a message that both asks for money AND uses
  // urgency AND wants to move off-platform is a materially different
  // situation than any single trait in isolation (spec §21's
  // "contextual sequences" principle, applied within one message). A
  // code only counts here if one of ITS OWN firing rules reached
  // 'meaningful'+ — a code that only ever fired a 'weak' rule (a bare
  // link, a bare off-platform mention) must not inflate this count
  // merely because some OTHER rule already pushed the overall band up.
  const bandBeforeCompounding = band
  const meaningfulOrAboveCodes = Array.from(
    new Set(RULES.filter((r) => riskBandAtLeast(r.band, 'meaningful') && r.fires(indicators)).map((r) => r.reasonCode))
  )
  if (meaningfulOrAboveCodes.length >= 3 && band !== 'severe') {
    band = 'severe'
  } else if (meaningfulOrAboveCodes.length === 2 && riskBandAtLeast(band, 'meaningful') && !riskBandAtLeast(band, 'high')) {
    band = 'high'
  }

  // Compounding may raise the reported risk band, but that increase
  // still has to clear the same explicit policy layer any directly-
  // fired rule does — it can only push enforcement up to at least the
  // (possibly bumped) band's own default, never past a specific rule's
  // own considered policy override.
  if (band !== bandBeforeCompounding) {
    disposition = moreRestrictiveDisposition(disposition, defaultDispositionForBand(band))
    escalateCase = escalateCase || defaultEscalateForBand(band)
  }

  // Personal contact / off-platform sharing — a DIFFERENT policy from
  // financial solicitation (see lib/safety/patterns/contact.ts). Allowed,
  // never a strike; on private letters it raises a 'warn' so the sender
  // gets a privacy heads-up (they can still send) and the recipient later
  // sees a short note. Added AFTER compounding on purpose: it is a weak
  // band and must never inflate the compounding count or open a case.
  if (options.privateLetter && detectContactSharing(rawText).kinds.length > 0) {
    reasonCodeSet.add('PERSONAL_CONTACT_SHARING')
    band = maxRiskBand(band, 'weak')
    disposition = moreRestrictiveDisposition(disposition, 'warn')
  }

  return {
    riskBand: band,
    reasonCodes: Array.from(reasonCodeSet),
    mutationDisposition: disposition,
    escalateCase,
  }
}
