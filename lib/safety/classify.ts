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
  /** For debugging/tests only — never returned to a member (see the
   * approved architecture's "minimize information returned" rule). */
  indicators: ExtractedIndicators
}

type Rule = {
  reasonCode: ContentReasonCode
  band: RiskBand
  fires: (i: ExtractedIndicators) => boolean
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
    reasonCode: 'CRYPTO_SOLICITATION',
    band: 'high',
    fires: (i) => i.hasCryptoKeyword && (i.hasDirectedMoneyRequest || i.cryptoAddresses.length > 0),
  },
  {
    // An actual wallet address being solicited is about as unambiguous
    // as text-only detection gets.
    reasonCode: 'CRYPTO_SOLICITATION',
    band: 'severe',
    fires: (i) => i.cryptoAddresses.length > 0 && (i.hasDirectedMoneyRequest || i.hasCryptoKeyword),
  },
  {
    reasonCode: 'INVESTMENT_SOLICITATION',
    band: 'high',
    fires: (i) => i.hasInvestmentPromiseLanguage,
  },
  {
    // A neutral investment topic alone is never solicitation (matches
    // "I lost money investing in crypto"); combined with off-platform
    // escalation, it reads as "let's move this conversation somewhere
    // I can pitch you" — the spec's own worked example.
    reasonCode: 'INVESTMENT_SOLICITATION',
    band: 'high',
    fires: (i) => i.hasInvestmentTopicKeyword && i.hasOffPlatformKeyword,
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
  },
  {
    reasonCode: 'PAYMENT_DETAILS',
    band: 'meaningful',
    fires: (i) => i.hasPaymentHandleKeyword && i.hasDirectedMoneyRequest,
  },
  {
    reasonCode: 'EMERGENCY_MONEY_REQUEST',
    band: 'high',
    fires: (i) =>
      i.hasEmergencyKeyword && (i.hasDirectedMoneyRequest || i.hasLoanOrBillRequestPhrase || i.moneyAmounts.length > 0),
  },
  {
    reasonCode: 'OFF_PLATFORM_ESCALATION',
    band: 'weak',
    fires: (i) => i.hasOffPlatformKeyword,
  },
  {
    reasonCode: 'OFF_PLATFORM_ESCALATION',
    band: 'high',
    fires: (i) =>
      i.hasOffPlatformKeyword &&
      (i.hasDirectedMoneyRequest || i.hasCryptoKeyword || i.hasInvestmentTopicKeyword || i.hasGiftCardKeyword),
  },
  {
    reasonCode: 'SUSPICIOUS_LINK',
    band: 'weak',
    fires: (i) => i.urls.length > 0,
  },
  {
    reasonCode: 'SUSPICIOUS_LINK',
    band: 'meaningful',
    fires: (i) => i.hasSuspiciousLinkShortener || (i.urls.length > 0 && (i.hasDirectedMoneyRequest || i.hasEmergencyKeyword)),
  },
  {
    reasonCode: 'PHISHING_SIGNAL',
    band: 'high',
    fires: (i) => i.urls.length > 0 && i.hasPhishingPhrase,
  },
]

/** Bare mentions that should never, alone, rise above 'weak' — used
 * only to decide whether a topic-only message (no fired rule at all)
 * still deserves a 'weak' band rather than 'none'. A pure financial
 * TOPIC (a currency amount describing a past purchase, or a crypto/
 * investment word with no request) is completely ordinary conversation
 * and the spec is explicit that it must never be treated as a
 * meaningful signal — 'weak' here exists only so a future behavioral
 * engine COULD optionally look at frequency of bare mentions, never so
 * a single benign sentence gets a warning. */
function hasAnyBareTopicMention(i: ExtractedIndicators): boolean {
  return (
    i.moneyAmounts.length > 0 ||
    i.hasCryptoKeyword ||
    i.hasInvestmentTopicKeyword ||
    i.hasGiftCardKeyword ||
    i.hasEmergencyKeyword ||
    i.hasPaymentHandleKeyword
  )
}

function decideDisposition(band: RiskBand): MutationDisposition {
  if (band === 'severe') return 'deny'
  if (riskBandAtLeast(band, 'meaningful')) return 'warn'
  return 'allow'
}

function decideEscalation(band: RiskBand): boolean {
  return riskBandAtLeast(band, 'high')
}

export function classifyContent(rawText: string): ClassificationResult {
  const indicators = extractIndicators(rawText)

  let band: RiskBand = 'none'
  const reasonCodeSet = new Set<ContentReasonCode>()

  for (const rule of RULES) {
    if (rule.fires(indicators)) {
      reasonCodeSet.add(rule.reasonCode)
      band = maxRiskBand(band, rule.band)
    }
  }

  // Compounding: independently-fired distinct reason codes at
  // 'meaningful' or above, together, read as more concerning than any
  // one of them alone — a message that both asks for money AND uses
  // urgency AND wants to move off-platform is a materially different
  // situation than any single trait in isolation (spec §21's
  // "contextual sequences" principle, applied within one message).
  const meaningfulOrAboveCodes = Array.from(
    new Set(
      RULES.filter((r) => riskBandAtLeast(r.band, 'meaningful') && r.fires(indicators)).map(
        (r) => r.reasonCode
      )
    )
  )
  if (meaningfulOrAboveCodes.length >= 3 && band !== 'severe') {
    band = 'severe'
  } else if (meaningfulOrAboveCodes.length === 2 && riskBandAtLeast(band, 'meaningful') && !riskBandAtLeast(band, 'high')) {
    band = 'high'
  }

  if (band === 'none' && hasAnyBareTopicMention(indicators)) {
    band = 'weak'
  }

  return {
    riskBand: band,
    reasonCodes: Array.from(reasonCodeSet),
    mutationDisposition: decideDisposition(band),
    escalateCase: decideEscalation(band),
    indicators,
  }
}
