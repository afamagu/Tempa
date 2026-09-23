// Safety 2 — structured indicator extraction. Pulls typed signals out
// of normalized text (lib/safety/normalize.ts); lib/safety/classify.ts
// is what actually weighs these into a risk band — this module never
// makes a policy decision itself, it only observes structure. Every
// extractor here is a plain regex/heuristic — deterministic, no
// external calls, matching the "no simplistic keyword filter, but also
// no external AI" boundary this checkpoint is scoped to.

import { toDisplayText, toCanonicalText, toNumericText } from './normalize'

export type MoneyAmount = { raw: string; value: number | null; currencyHint: string | null }

export type ExtractedIndicators = {
  urls: string[]
  emails: string[]
  phoneNumbers: string[]
  moneyAmounts: MoneyAmount[]
  cryptoAddresses: string[]
  hasCryptoKeyword: boolean
  hasGiftCardKeyword: boolean
  hasGiftCardCodeRequest: boolean
  /** Inherently solicitation-shaped ("I can double your money",
   * "guaranteed returns") — fires regardless of a separate directed-
   * request match, since these phrases already address the recipient's
   * money directly. */
  hasInvestmentPromiseLanguage: boolean
  /** Neutral topic mention only ("invest", "forex", "trading platform")
   * — never fires solicitation alone; see lib/safety/classify.ts for
   * how this combines with other indicators (e.g. off-platform). */
  hasInvestmentTopicKeyword: boolean
  hasPaymentHandleKeyword: boolean
  hasBankDetailsSharedPhrase: boolean
  hasOffPlatformKeyword: boolean
  hasEmergencyKeyword: boolean
  hasUrgencyLanguage: boolean
  hasDirectedMoneyRequest: boolean
  hasLoanOrBillRequestPhrase: boolean
  hasSuspiciousLinkShortener: boolean
  hasPhishingPhrase: boolean
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+\.[a-z]{2,}[^\s<>"']*/gi
const EMAIL_PATTERN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi
const PHONE_PATTERN = /(?:\+?\d[\d\-. ]{7,}\d)/g
const LINK_SHORTENER_PATTERN = /\b(bit\.ly|tinyurl\.com|t\.co|is\.gd|cutt\.ly|rebrand\.ly|goo\.gl)\b/i

// BTC (legacy/P2SH/bech32 prefixes) and EVM-style hex addresses. Not
// exhaustive of every chain — a deterministic, low-false-positive
// pattern for the most common address shapes, per spec §6 "crypto
// addresses where practical".
const CRYPTO_ADDRESS_PATTERN = /\b(?:0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,39})\b/g

const CURRENCY_SYMBOL_AMOUNT_PATTERN = /([$€£₦₹¥])\s?(\d[\d,]*(?:\.\d+)?)\s?(k)?\b/gi
const CURRENCY_WORD_AMOUNT_PATTERN =
  /\b(\d[\d,]*(?:\.\d+)?)\s?(k)?\s?(dollars?|usd|naira|ngn|pounds?|gbp|euros?|eur|rupees?|inr)\b/gi

const CRYPTO_KEYWORD_PATTERN =
  /\b(bitcoin|btc|ethereum|eth|usdt|tether|crypto(?:currency)?|wallet address|binance|blockchain|metamask)\b/i
const GIFT_CARD_KEYWORD_PATTERN = /\b(gift ?card|steam card|google play card|itunes card|amazon card|redeem code)\b/i
const GIFT_CARD_CODE_REQUEST_PATTERN =
  /\b(buy|purchase|get)\b.{0,30}\b(gift ?card|steam card|google play card|itunes card)\b.{0,40}\b(send|share|give)\b.{0,15}\b(code|number|pin)\b/i
const INVESTMENT_PROMISE_PATTERN =
  /\bi (?:can|will|could) double\b|\bdouble your (?:money|investment)\b|\bguaranteed (?:returns?|profit)\b/i
const INVESTMENT_TOPIC_PATTERN = /\b(invest(?:ment|ing)?|forex|trading (?:opportunity|platform))\b/i
const PAYMENT_HANDLE_PATTERN = /\b(paypal|cash ?app|venmo|zelle|western union|moneygram)\b|\$[a-z][a-z0-9_]{2,}\b/i
const BANK_DETAILS_SHARED_PATTERN =
  /\b(here(?:'s| is) my (?:bank )?(?:account|routing)|account number is|routing number is|iban)\b/i
const OFF_PLATFORM_KEYWORD_PATTERN =
  /\b(telegram|whatsapp|signal app|instagram|snapchat|hangouts)\b.{0,25}\b(me|this|here|us)?\b|\b(text me|dm me|add me|message me|contact me)\b.{0,25}\b(on|at|via)\b/i
const EMERGENCY_KEYWORD_PATTERN = /\b(emergency|urgent(?:ly)?|hospital(?:ized)?|surgery|accident|stranded|deported)\b/i
const URGENCY_LANGUAGE_PATTERN = /\b(right away|immediately|as soon as possible|asap|before it'?s too late|today only)\b/i
const LOAN_OR_BILL_PHRASE_PATTERN =
  /\b(help (?:me )?(?:pay|with|cover)|pay (?:for )?my)\b.{0,25}\b(rent|bill|bills|electricity|tuition|fees|loan|debt)\b/i
const PHISHING_PHRASE_PATTERN = /\b(verify your account|confirm your payment|update your (?:billing|payment) (?:info|details))\b/i

// A "directed" request: an imperative or interrogative asking the
// RECIPIENT to move money/value, as opposed to a descriptive statement
// about the sender's own finances. This is the single most important
// discriminator between "Bitcoin fell again" (no request) and "send me
// $300" (a request) — see lib/safety/classify.ts.
const DIRECTED_MONEY_REQUEST_PATTERN =
  /\b(can|could|would) you\b.{0,30}\b(send|pay|transfer|wire|lend|give)\b|\bplease\b.{0,20}\b(send|pay|transfer|wire)\b|\b(send|pay|transfer|wire)\b.{0,15}\bme\b|\b(send|pay|transfer|wire)\b.{0,20}\bto\b.{0,15}\b(this|my|the)\b.{0,10}\b(wallet|account)\b|\bbuy me\b|\bi need you to\b.{0,20}\b(send|pay|transfer|wire|buy)\b|\bi need\b.{0,15}\b(money|funds|cash)\b/i

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function parseAmountValue(digits: string, kilo: boolean): number | null {
  const cleaned = Number(digits.replace(/,/g, ''))
  if (!Number.isFinite(cleaned)) return null
  return kilo ? cleaned * 1000 : cleaned
}

function extractMoneyAmounts(displayText: string, numericText: string): MoneyAmount[] {
  const amounts: MoneyAmount[] = []

  for (const match of numericText.matchAll(CURRENCY_SYMBOL_AMOUNT_PATTERN)) {
    amounts.push({ raw: match[0], currencyHint: match[1], value: parseAmountValue(match[2], Boolean(match[3])) })
  }
  for (const match of numericText.matchAll(CURRENCY_WORD_AMOUNT_PATTERN)) {
    amounts.push({ raw: match[0], currencyHint: match[3], value: parseAmountValue(match[1], Boolean(match[2])) })
  }
  // Fall back to the plain display text too, in case a currency symbol
  // amount had no digits needing numeric obfuscation-repair (the
  // common, non-obfuscated case) — matchAll on both sources and
  // de-duplicate by raw text below.
  for (const match of displayText.matchAll(CURRENCY_SYMBOL_AMOUNT_PATTERN)) {
    amounts.push({ raw: match[0], currencyHint: match[1], value: parseAmountValue(match[2], Boolean(match[3])) })
  }
  for (const match of displayText.matchAll(CURRENCY_WORD_AMOUNT_PATTERN)) {
    amounts.push({ raw: match[0], currencyHint: match[3], value: parseAmountValue(match[1], Boolean(match[2])) })
  }

  const seen = new Set<string>()
  return amounts.filter((amount) => {
    const key = amount.raw.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function extractIndicators(rawText: string): ExtractedIndicators {
  const displayText = toDisplayText(rawText)
  const canonicalText = toCanonicalText(rawText)
  const numericText = toNumericText(rawText)

  return {
    urls: unique(Array.from(displayText.matchAll(URL_PATTERN)).map((m) => m[0])),
    emails: unique(Array.from(displayText.matchAll(EMAIL_PATTERN)).map((m) => m[0])),
    phoneNumbers: unique(
      Array.from(displayText.matchAll(PHONE_PATTERN))
        .map((m) => m[0])
        .filter((m) => m.replace(/\D/g, '').length >= 8)
    ),
    moneyAmounts: extractMoneyAmounts(displayText, numericText),
    cryptoAddresses: unique(Array.from(displayText.matchAll(CRYPTO_ADDRESS_PATTERN)).map((m) => m[0])),
    hasCryptoKeyword: CRYPTO_KEYWORD_PATTERN.test(canonicalText),
    hasGiftCardKeyword: GIFT_CARD_KEYWORD_PATTERN.test(canonicalText),
    hasGiftCardCodeRequest: GIFT_CARD_CODE_REQUEST_PATTERN.test(canonicalText),
    hasInvestmentPromiseLanguage: INVESTMENT_PROMISE_PATTERN.test(canonicalText),
    hasInvestmentTopicKeyword: INVESTMENT_TOPIC_PATTERN.test(canonicalText),
    hasPaymentHandleKeyword: PAYMENT_HANDLE_PATTERN.test(canonicalText),
    hasBankDetailsSharedPhrase: BANK_DETAILS_SHARED_PATTERN.test(canonicalText),
    hasOffPlatformKeyword: OFF_PLATFORM_KEYWORD_PATTERN.test(canonicalText),
    hasEmergencyKeyword: EMERGENCY_KEYWORD_PATTERN.test(canonicalText),
    hasUrgencyLanguage: URGENCY_LANGUAGE_PATTERN.test(canonicalText),
    hasDirectedMoneyRequest: DIRECTED_MONEY_REQUEST_PATTERN.test(canonicalText),
    hasLoanOrBillRequestPhrase: LOAN_OR_BILL_PHRASE_PATTERN.test(canonicalText),
    hasSuspiciousLinkShortener: LINK_SHORTENER_PATTERN.test(displayText),
    hasPhishingPhrase: PHISHING_PHRASE_PATTERN.test(canonicalText),
  }
}
