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
  /** Explicit pitch/proposition language ("forex opportunity", "invest
   * with me", "show you the investment") — deliberately NOT "a topic
   * word and an off-platform mention somewhere in the same sentence",
   * which is punctuation-dependent (a comma vs. a period changes
   * whether two unrelated clauses count as "the same sentence") and
   * flags things like "I lost money investing in crypto last year,
   * let's chat on WhatsApp sometime." — two unrelated asides, not a
   * pitch. Only actual proposition language counts. */
  hasInvestmentPitchContext: boolean
  hasPaymentHandleKeyword: boolean
  hasBankDetailsSharedPhrase: boolean
  hasOffPlatformKeyword: boolean
  hasEmergencyKeyword: boolean
  hasUrgencyLanguage: boolean
  /** A directed request for money/value. A bare directed-action verb
   * ("can you send me a photo?", "could you give me your opinion?",
   * "can you pay attention?") is never enough on its own — different
   * verb classes require different proof (see the verb-class patterns
   * below): "transfer"/"wire" carry strong inherent financial meaning
   * and only need a financial term somewhere in the same SENTENCE;
   * "send"/"give"/"lend"/"pay"/"buy" have ordinary non-financial senses
   * too, so their financial object must be LOCALLY tied to the verb (a
   * short character window right after it), not merely present
   * anywhere later in the sentence — "Can you send me the photo of the
   * camera I bought for $300?" must not count the unrelated $300. */
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
// Explicit proposition/offer language — deliberately phrase-based
// rather than "topic word + off-platform mention nearby", which is
// too easily satisfied by two unrelated asides (see
// hasInvestmentPitchContext's doc comment above).
const INVESTMENT_PITCH_PHRASE_PATTERN =
  /\b(?:forex|trading|investment|crypto) opportunity\b|\binvest(?:ing)? with me\b|\bshow you (?:how to (?:invest|trade)|the investment)\b/i
// The literal app/service names are letter-based and safe to match
// against the aggressively-folded canonical text. A cashtag ("$name")
// is symbol-based and must NEVER be tested against canonical text —
// toCanonicalText()'s leet-speak pass rewrites '$' to 's' for keyword
// matching, which would silently destroy every cashtag before this
// pattern ever saw it. See CASHTAG_PATTERN below, tested against
// display text instead.
const PAYMENT_HANDLE_KEYWORD_PATTERN = /\b(paypal|cash ?app|venmo|zelle|western union|moneygram)\b/i
const CASHTAG_PATTERN = /\$[a-zA-Z][a-zA-Z0-9_]{2,}\b/
// Only an actual disclosure — "here is my account/IBAN", "account
// number is", "my IBAN is ...", or a labeled "IBAN:" value — counts as
// details being SHARED. A bare mention of the word "IBAN" ("What
// exactly is an IBAN?") OR an explanatory definition ("IBAN is an
// international bank account identifier.") is a topic mention, not a
// disclosure — "iban is" alone is NOT enough; it must be "MY iban is"
// (first-person possessive) or a colon-labeled value.
const BANK_DETAILS_SHARED_PATTERN =
  /\bhere(?:'s| is) my (?:bank )?(?:account|routing|iban)\b|\baccount number is\b|\brouting number is\b|\bmy iban is\b|\biban:\s*\S/i
const OFF_PLATFORM_KEYWORD_PATTERN =
  /\b(telegram|whatsapp|signal app|instagram|snapchat|hangouts)\b.{0,25}\b(me|this|here|us)?\b|\b(text me|dm me|add me|message me|contact me)\b.{0,25}\b(on|at|via)\b/i
const EMERGENCY_KEYWORD_PATTERN = /\b(emergency|urgent(?:ly)?|hospital(?:ized)?|surgery|accident|stranded|deported)\b/i
const URGENCY_LANGUAGE_PATTERN = /\b(right away|immediately|as soon as possible|asap|before it'?s too late|today only)\b/i
const LOAN_OR_BILL_PHRASE_PATTERN =
  /\b(help (?:me )?(?:pay|with|cover)|pay (?:for )?my)\b.{0,25}\b(rent|bill|bills|electricity|tuition|fees|loan|debt)\b/i
const PHISHING_PHRASE_PATTERN = /\b(verify your account|confirm your payment|update your (?:billing|payment) (?:info|details))\b/i
const MONEY_WORD_PATTERN = /\b(money|funds?|cash|payment)\b/i

// "i need money/funds/cash" already carries its own financial object —
// no verb-object locality question, it's self-contained.
const NEED_MONEY_PATTERN = /\bi need\b.{0,15}\b(money|funds|cash)\b/i

// "transfer"/"wire" are rarely used for anything but moving value —
// no ordinary correspondence sense ("transfer me a photo" doesn't
// happen) — so these are checked at SENTENCE level like before: the
// verb anywhere in the sentence plus a financial term anywhere in the
// same sentence is enough.
const STRONG_TRANSFER_VERB_PATTERN =
  /\b(can|could|would) you\b.{0,30}\b(transfer|wire)\b|\bplease\b.{0,20}\b(transfer|wire)\b|\b(transfer|wire)\b.{0,15}\bme\b|\b(transfer|wire)\b.{0,20}\bto\b.{0,15}\b(this|my|the)\b.{0,10}\b(wallet|account)\b|\bi need you to\b.{0,20}\b(transfer|wire)\b/i

// "send"/"give"/"lend"/"pay"/"buy" all have ordinary non-financial
// senses ("send me a photo", "give me your opinion", "lend me that
// book", "pay attention", "buy me a coffee") — a bare sentence-wide
// financial term is NOT enough for these; the term must be LOCALLY
// tied to the verb (see sentenceHasLocallyDirectedMoneyRequest below).
// This pattern only finds the verb+object LEAD-IN; it says nothing
// about whether the object is financial.
const LOCAL_TIE_VERB_LEAD_IN_PATTERN =
  /\b(?:can|could|would) you\b.{0,15}\b(?:send|give|lend|pay|buy)\b(?:\s+me\b)?|\bplease\b.{0,15}\b(?:send|pay)\b(?:\s+me\b)?|\b(?:send|give|lend|pay)\b\s+me\b|\bbuy me\b|\bi need you to\b.{0,15}\b(?:send|pay|buy)\b(?:\s+me\b)?/i

// How far past a local-tie verb's lead-in to look for its financial
// object. Long enough for "send me $300"/"give me your PayPal", short
// enough to exclude a financial term in a LATER, unrelated clause
// ("...the camera I bought for $300" starts well past this window).
// An approximation, like every other window in this file — not an
// attempt at real clause parsing.
const LOCAL_OBJECT_WINDOW_CHARS = 30

// A transfer verb followed closely by "to" and then an actual crypto
// address ("send USDT to 0x...") is unambiguous regardless of whether
// the address is also preceded by a recognizable word like "wallet" —
// checked against DISPLAY text (never canonical — canonicalization's
// leet-speak pass would corrupt hex digits in the address itself).
const TRANSFER_VERB_TO_PATTERN = /\b(send|pay|transfer|wire)\b.{0,20}\bto\b/i

// Self-contained, like NEED_MONEY_PATTERN: "wallet"/"account" IS the
// financial object here, directly adjacent to "this/my/the" — no
// separate local-window check needed regardless of verb class.
const TRANSFER_TO_ACCOUNT_PATTERN =
  /\b(send|pay|transfer|wire)\b.{0,20}\bto\b.{0,15}\b(this|my|the)\b.{0,10}\b(wallet|account)\b/i

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

/** Tests a pattern without mutating a shared global/sticky regex's
 * `lastIndex` — several patterns below carry a 'g' flag for use with
 * matchAll() elsewhere in this file, and calling .test() directly on
 * those would be stateful across calls. */
function testPattern(pattern: RegExp, text: string): boolean {
  return new RegExp(pattern.source, pattern.flags.replace('g', '')).test(text)
}

/** Naive sentence split — good enough for a LOCAL PROXIMITY check
 * (does a request verb and a financial term appear in the same
 * breath?), not for anything requiring linguistic precision. Splitting
 * on the ORIGINAL display text (not canonical/numeric) keeps sentence
 * boundaries stable before any lossy matching-only transformation. */
function splitIntoSentences(displayText: string): string[] {
  return displayText.split(/(?<=[.!?])\s+|\n+/).filter((sentence) => sentence.trim().length > 0)
}

function hasFinancialTerm(canonicalSpan: string, numericSpan: string, displaySpan: string): boolean {
  return (
    MONEY_WORD_PATTERN.test(canonicalSpan) ||
    PAYMENT_HANDLE_KEYWORD_PATTERN.test(canonicalSpan) ||
    testPattern(CASHTAG_PATTERN, displaySpan) ||
    CRYPTO_KEYWORD_PATTERN.test(canonicalSpan) ||
    GIFT_CARD_KEYWORD_PATTERN.test(canonicalSpan) ||
    LOAN_OR_BILL_PHRASE_PATTERN.test(canonicalSpan) ||
    testPattern(CURRENCY_SYMBOL_AMOUNT_PATTERN, numericSpan) ||
    testPattern(CURRENCY_WORD_AMOUNT_PATTERN, numericSpan) ||
    testPattern(CRYPTO_ADDRESS_PATTERN, displaySpan)
  )
}

/** send/give/lend/pay/buy: require the financial term to appear in a
 * bounded window right after the verb's lead-in, not merely somewhere
 * in the sentence. canonicalSentence is where the (possibly leet-
 * obfuscated) verb lead-in is found; that match's end index is then
 * used to window into all three text representations. Note this index
 * can drift slightly out of alignment with displaySentence/
 * numericSentence when heavy letter-spacing obfuscation occurred
 * earlier in the same sentence (collapseLetterSpacing changes length)
 * — an accepted approximation, like every other heuristic in this
 * file; the window is generous enough to absorb the common case. */
function sentenceHasLocallyDirectedMoneyRequest(
  displaySentence: string,
  canonicalSentence: string,
  numericSentence: string
): boolean {
  const match = LOCAL_TIE_VERB_LEAD_IN_PATTERN.exec(canonicalSentence)
  if (!match) return false
  // LOAN_OR_BILL_PHRASE_PATTERN already carries its own internal
  // proximity (a help/pay verb within 25 chars of rent/bill/etc) and
  // is safe to check against the whole sentence — checking only the
  // POST-lead-in window here would exclude the "pay"/"help" word the
  // phrase pattern itself needs, since that word was just consumed by
  // the lead-in match above.
  if (LOAN_OR_BILL_PHRASE_PATTERN.test(canonicalSentence)) return true
  const objectStart = match.index + match[0].length
  const canonicalObject = canonicalSentence.slice(objectStart, objectStart + LOCAL_OBJECT_WINDOW_CHARS)
  const displayObject = displaySentence.slice(objectStart, objectStart + LOCAL_OBJECT_WINDOW_CHARS)
  const numericObject = numericSentence.slice(objectStart, objectStart + LOCAL_OBJECT_WINDOW_CHARS)
  return hasFinancialTerm(canonicalObject, numericObject, displayObject)
}

function sentenceHasDirectedCryptoTransfer(displaySentence: string, canonicalSentence: string): boolean {
  return TRANSFER_VERB_TO_PATTERN.test(canonicalSentence) && testPattern(CRYPTO_ADDRESS_PATTERN, displaySentence)
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

  const sentences = splitIntoSentences(displayText)
  const hasDirectedMoneyRequest = sentences.some((sentence) => {
    const canonicalSentence = toCanonicalText(sentence)
    if (NEED_MONEY_PATTERN.test(canonicalSentence) || TRANSFER_TO_ACCOUNT_PATTERN.test(canonicalSentence)) return true
    const numericSentence = toNumericText(sentence)
    if (STRONG_TRANSFER_VERB_PATTERN.test(canonicalSentence) && hasFinancialTerm(canonicalSentence, numericSentence, sentence)) {
      return true
    }
    if (sentenceHasLocallyDirectedMoneyRequest(sentence, canonicalSentence, numericSentence)) return true
    return sentenceHasDirectedCryptoTransfer(sentence, canonicalSentence)
  })
  const hasInvestmentPitchContext = INVESTMENT_PITCH_PHRASE_PATTERN.test(canonicalText)

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
    hasInvestmentPitchContext,
    hasPaymentHandleKeyword: PAYMENT_HANDLE_KEYWORD_PATTERN.test(canonicalText) || testPattern(CASHTAG_PATTERN, displayText),
    hasBankDetailsSharedPhrase: BANK_DETAILS_SHARED_PATTERN.test(canonicalText),
    hasOffPlatformKeyword: OFF_PLATFORM_KEYWORD_PATTERN.test(canonicalText),
    hasEmergencyKeyword: EMERGENCY_KEYWORD_PATTERN.test(canonicalText),
    hasUrgencyLanguage: URGENCY_LANGUAGE_PATTERN.test(canonicalText),
    hasDirectedMoneyRequest,
    hasLoanOrBillRequestPhrase: LOAN_OR_BILL_PHRASE_PATTERN.test(canonicalText),
    hasSuspiciousLinkShortener: LINK_SHORTENER_PATTERN.test(displayText),
    hasPhishingPhrase: PHISHING_PHRASE_PATTERN.test(canonicalText),
  }
}
