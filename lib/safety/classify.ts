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
import {
  maxRiskBand,
  riskBandAtLeast,
  type ContentReasonCode,
  type MutationDisposition,
  type RiskBand,
} from './reason-codes'

export type ClassificationResult = {
  riskBand: RiskBand
  reasonCodes: ContentReasonCode[]
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
const RULES: Rule[] = [
  {
    reasonCode: 'DIRECT_MONEY_REQUEST',
    band: 'meaningful',
    fires: (i) => i.hasDirectedMoneyRequest && !i.hasCryptoKeyword && !i.hasGiftCardKeyword,
  },
  {
    // A directed request WITH an explicit amount is more concrete than
    // a bare request — bumped to 'high'.
    reasonCode: 'DIRECT_MONEY_REQUEST',
    band: 'high',
    fires: (i) => i.hasDirectedMoneyRequest && i.moneyAmounts.length > 0,
  },
  {
    reasonCode: 'LOAN_OR_BILL_REQUEST',
    band: 'meaningful',
    fires: (i) => i.hasLoanOrBillRequestPhrase,
  },
  {
    // A crypto keyword alone ("my Ethereum wallet address is 0x...")
    // is a topic/disclosure, not a solicitation — this requires an
    // actual directed request (hasDirectedMoneyRequest already covers
    // "send USDT to 0x..." via the transfer-verb+address check in
    // indicators.ts).
    reasonCode: 'CRYPTO_SOLICITATION',
    band: 'high',
    fires: (i) => i.hasCryptoKeyword && i.hasDirectedMoneyRequest,
  },
  {
    // An address being SOLICITED (transfer verb + the address, or a
    // crypto keyword alongside an actual request) is unambiguous. An
    // address merely being STATED, with no request attached ("my
    // wallet address is 0x...", "this article uses 0x... as an
    // example"), is not — a bare address+keyword co-occurrence is not
    // enough for 'severe' by itself.
    reasonCode: 'CRYPTO_SOLICITATION',
    band: 'severe',
    fires: (i) => i.cryptoAddresses.length > 0 && i.hasDirectedMoneyRequest,
  },
  {
    reasonCode: 'INVESTMENT_SOLICITATION',
    band: 'high',
    fires: (i) => i.hasInvestmentPromiseLanguage,
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
  },
  {
    reasonCode: 'GIFT_CARD_REQUEST',
    band: 'meaningful',
    fires: (i) => i.hasGiftCardKeyword && i.hasDirectedMoneyRequest,
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
    fires: (i) => i.hasPaymentHandleKeyword && i.hasDirectedMoneyRequest,
  },
  {
    // Emergency VOCABULARY plus an incidental amount ("My hospital
    // bill was $500.", "The surgery cost us $2,000.") is a descriptive
    // statement, not a solicitation — this requires an actual request
    // for money/payment/value (a directed money request or a genuine
    // bill/loan-help ask), not merely emergency words co-occurring
    // with a number.
    reasonCode: 'EMERGENCY_MONEY_REQUEST',
    band: 'high',
    fires: (i) => i.hasEmergencyKeyword && (i.hasDirectedMoneyRequest || i.hasLoanOrBillRequestPhrase),
  },
  {
    reasonCode: 'OFF_PLATFORM_ESCALATION',
    band: 'weak',
    fires: (i) => i.hasOffPlatformKeyword,
  },
  {
    // Off-platform correlates with genuine solicitation shapes only:
    // an actual directed money request, explicit investment pitch
    // language, or an explicit investment promise — never a bare topic
    // word co-occurring somewhere in the message (see
    // hasInvestmentPitchContext's doc comment in indicators.ts).
    reasonCode: 'OFF_PLATFORM_ESCALATION',
    band: 'high',
    fires: (i) => i.hasOffPlatformKeyword && (i.hasDirectedMoneyRequest || i.hasInvestmentPitchContext || i.hasInvestmentPromiseLanguage),
  },
  {
    reasonCode: 'SUSPICIOUS_LINK',
    band: 'weak',
    fires: (i) => i.urls.length > 0,
  },
  {
    // A link next to emergency/hospital vocabulary is completely
    // ordinary ("This is the hospital website: https://...") — only an
    // actual directed money request (or a suspicious shortener)
    // upgrades a bare link to 'meaningful'. Genuine phishing concern is
    // otherwise carried by PHISHING_SIGNAL's own explicit-phrase rule
    // below.
    reasonCode: 'SUSPICIOUS_LINK',
    band: 'meaningful',
    fires: (i) => i.hasSuspiciousLinkShortener || (i.urls.length > 0 && i.hasDirectedMoneyRequest),
  },
  {
    reasonCode: 'PHISHING_SIGNAL',
    band: 'high',
    fires: (i) => i.urls.length > 0 && i.hasPhishingPhrase,
  },
]

const DISPOSITION_SEVERITY: Record<MutationDisposition, number> = { allow: 0, warn: 1, deny: 2 }

function moreRestrictiveDisposition(a: MutationDisposition, b: MutationDisposition): MutationDisposition {
  return DISPOSITION_SEVERITY[a] >= DISPOSITION_SEVERITY[b] ? a : b
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

export function classifyContent(rawText: string): ClassificationResult {
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

  return {
    riskBand: band,
    reasonCodes: Array.from(reasonCodeSet),
    mutationDisposition: disposition,
    escalateCase,
  }
}
