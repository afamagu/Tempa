// Safety 2 — structured indicator extraction. Pulls typed signals out
// of normalized text (lib/safety/normalize.ts); lib/safety/classify.ts
// is what actually weighs these into a risk band — this module never
// makes a policy decision itself, it only observes structure. Every
// extractor here is a plain regex/heuristic — deterministic, no
// external calls, matching the "no simplistic keyword filter, but also
// no external AI" boundary this checkpoint is scoped to.
//
// LOCALITY PRINCIPLE: a long letter can contain several unrelated
// topics. Raw facts like "this message contains an amount" or "this
// message mentions crypto" say nothing about whether that amount/topic
// is actually part of a request — "Can you send me $100? This article
// uses 0x... as an example Ethereum address." must not become crypto
// solicitation just because a directed request and a crypto mention
// both happen to exist somewhere in the text. Every composite indicator
// below (hasDirected*, has*Request, has*LinkedUrl, ...) is built by
// binding facts within the SAME sentence (or an even tighter local
// window right after a request verb) — never by ANDing message-wide
// booleans/arrays together. classify.ts must only combine these
// composites, never the raw per-message fields, when expressing a
// relationship between two facts.

import { toDisplayText, toCanonicalText, toNumericText } from './normalize'
import { analyzeSolicitations, isNotARequest, stripReportedQuotes, type SolicitationHit } from './patterns'

export type MoneyAmount = { raw: string; value: number | null; currencyHint: string | null }

export type ExtractedIndicators = {
  urls: string[]
  emails: string[]
  phoneNumbers: string[]
  moneyAmounts: MoneyAmount[]
  cryptoAddresses: string[]
  hasCryptoKeyword: boolean
  hasGiftCardKeyword: boolean
  /** The narrow "buy a gift card, send me the code" scam shape — bound
   * to a single SENTENCE (see GIFT_CARD_CODE_REQUEST_PATTERN's own
   * internal proximity budgets), not the whole message, so it can't
   * bridge two genuinely unrelated sentences ("I bought a Steam gift
   * card. Please send me the code for the front gate."). */
  hasGiftCardCodeRequest: boolean
  /** Inherently solicitation-shaped ("double your money", "guaranteed
   * returns") — fires regardless of a separate directed-request match,
   * since these phrases already address the recipient's money
   * directly. Excludes DISCUSSION of the phrase ("Anyone promising to
   * double your money is probably scamming you.") — see
   * INVESTMENT_PROMISE_DISCUSSION_PATTERN. */
  hasInvestmentPromiseLanguage: boolean
  /** Neutral topic mention only ("invest", "forex", "trading platform")
   * — never fires solicitation alone. */
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
   * "can you pay attention?") is never enough on its own — the
   * financial object must be LOCALLY tied to the verb (a short
   * character window right after it, cut off at the first clause
   * boundary), not merely present anywhere later in the sentence —
   * "Can you send me the photo of the camera I bought for $300?" and
   * "Can you transfer me the file I bought for $300?" must not count
   * the unrelated $300. See LOCAL_TIE_VERB_LEAD_IN_PATTERN. */
  hasDirectedMoneyRequest: boolean
  /** hasDirectedMoneyRequest where the SAME request also has an amount
   * locally bound to it — replaces a message-wide `moneyAmounts.length
   * > 0` check, which would count an unrelated amount elsewhere in the
   * letter ("Could you send me some money? My camera cost $300."). */
  hasDirectedMoneyRequestWithAmount: boolean
  /** hasDirectedMoneyRequest where the SAME request is also tied to a
   * crypto keyword or address — replaces `hasCryptoKeyword &&
   * hasDirectedMoneyRequest`, which would fire from two unrelated
   * sentences ("Can you send me $100? This article uses 0x... as an
   * example Ethereum address."). */
  hasDirectedCryptoRequest: boolean
  /** hasDirectedCryptoRequest, but specifically tied to an ACTUAL
   * address rather than just a keyword — the bar for treating a crypto
   * solicitation as 'severe'. A bare "my wallet address is 0x..."
   * statement (no request) is not this; "Send USDT to 0x..." is. */
  hasDirectedCryptoTransfer: boolean
  /** hasDirectedMoneyRequest where the SAME request is also tied to a
   * gift-card keyword — replaces `hasGiftCardKeyword &&
   * hasDirectedMoneyRequest`. */
  hasDirectedGiftCardRequest: boolean
  /** hasDirectedMoneyRequest where the SAME request is also tied to a
   * payment-handle keyword or cashtag — replaces `hasPaymentHandleKeyword
   * && hasDirectedMoneyRequest`. */
  hasDirectedPaymentHandleRequest: boolean
  /** Emergency vocabulary in the SAME CLAUSE (not just sentence — see
   * splitIntoClauses) as an actual request (a directed money request or
   * a genuine bill/loan-help ask) — replaces `hasEmergencyKeyword &&
   * hasDirectedMoneyRequest`, which would fire from an unrelated
   * clause sharing the same sentence ("Could you send me some money,
   * my brother works at a hospital."). */
  hasEmergencyFramedMoneyRequest: boolean
  /** An off-platform mention in the SAME CLAUSE as an actual
   * solicitation shape (a directed money request, explicit investment
   * pitch language, or an explicit investment promise) — replaces
   * `hasOffPlatformKeyword && hasDirectedMoneyRequest`. A comma joining
   * two unrelated clauses in one sentence ("Could you send me some
   * money, and let's chat on WhatsApp later about the football match.")
   * must not count. */
  hasOffPlatformSolicitation: boolean
  /** A URL in the SAME sentence as a directed money request — replaces
   * `urls.length > 0 && hasDirectedMoneyRequest`, which would fire from
   * an unrelated link elsewhere in the letter ("Could you send me some
   * money? Here is an article I liked: https://example.com"). */
  hasSolicitationLinkedUrl: boolean
  /** A URL in the SAME sentence as an explicit phishing phrase —
   * replaces `urls.length > 0 && hasPhishingPhrase`. */
  hasPhishingLinkedUrl: boolean
  /** A suspicious link shortener in the SAME CLAUSE as an actual
   * solicitation shape (a directed request, a phishing phrase, or an
   * explicit investment pitch/promise) — deliberately NOT "a bare
   * crypto/payment-service topic word shares the clause": "I use
   * PayPal and here is the recipe: https://bit.ly/example" and "I was
   * reading about Bitcoin and here is the recipe: https://bit.ly/
   * example" are not suspicious just because a shortener happens to
   * share a clause with an unrelated topic mention. A shortener alone,
   * or with only a bare topic for company, is a weak structural signal
   * (see SUSPICIOUS_LINK's 'weak' rule), never 'meaningful'. */
  hasSuspiciousShortenerWithContext: boolean
  hasLoanOrBillRequestPhrase: boolean
  hasSuspiciousLinkShortener: boolean
  hasPhishingPhrase: boolean
  /** The COMPOSITIONAL Pattern Library's own findings (lib/safety/
   * patterns/solicitation.ts) — financial need/value + a request
   * DIRECTED at the recipient (+ optional urgency/payment-method/story
   * context, with a bare final ask inheriting only the immediately
   * preceding sentences' financial context). These, not the older
   * phrase-shaped indicators above, are what make a solicitation
   * CONFIRMED (and therefore not sendable) — see classify.ts. Each is
   * bound to the ONE sentence that carried the ask, never message-wide. */
  solicitedMoney: boolean
  solicitedBillOrLoan: boolean
  solicitedGiftCard: boolean
  solicitedCrypto: boolean
  solicitedPaymentMethod: boolean
  solicitedIntermediary: boolean
  solicitedInvestment: boolean
  /** Some confirmed solicitation carried a concrete amount. */
  solicitedWithAmount: boolean
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
// Requires an explicit FINANCIAL object ("double YOUR MONEY/
// INVESTMENT"), not a bare "I can/will/could double" — that alone also
// matches ordinary sentences ("I can double the recipe.", "I will
// double-check that tomorrow." — "double-check" contains a word
// boundary right after "double", so a naive `double\b` pattern would
// have matched it too).
const INVESTMENT_PROMISE_PATTERN = /\bdouble your (?:money|investment|cash|funds)\b|\bguaranteed (?:returns?|profit)\b/i
// DISCUSSING or warning about the scam phrase ("Anyone promising to
// double your money is probably scamming you.") is not itself a
// promise being made to the reader.
const INVESTMENT_PROMISE_DISCUSSION_PATTERN =
  /\b(?:anyone|someone|people|scammers?|they)\b.{0,20}\bpromis\w*\b.{0,20}\bdouble your\b/i
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
  // "pay my <bill>" only counts in a request frame (an imperative or a
  // second-person ask) — "I need to pay my electricity bill tomorrow" is
  // the writer paying their own bill, not asking anyone else to.
  /\b(help (?:me )?(?:pay|with|cover))\b.{0,25}\b(rent|bill|bills|electricity|tuition|fees|loan|debt)\b|(?:(?:^|[.!?]\s+)(?:please\s+)?|\b(?:please|kindly|can you|could you|would you|will you|you can|you could|you should|you must|you need to|just)\s+)pay (?:for )?my\b.{0,25}\b(rent|bill|bills|electricity|tuition|fees|loan|debt)\b/i
const PHISHING_PHRASE_PATTERN = /\b(verify your account|confirm your payment|update your (?:billing|payment) (?:info|details))\b/i
const MONEY_WORD_PATTERN = /\b(money|funds?|cash|payment)\b/i

// "i need money/funds/cash" already carries its own financial object —
// no verb-object locality question, it's self-contained.
// "I need funds ... but I will get them from my bonus" / "I need cash for
// the market, so I am stopping by the ATM" — the writer resolves their
// own need in the same sentence; nothing is being asked of anyone.
const NEED_SELF_RESOLVED_PATTERN =
  /\b(?:but|so|and|then)\s+i(?:'ll|'m|\s+will|\s+am|\s+can|\s+have|\s+already|\s+got|\s+just)\b|\bfrom my (?:own )?(?:savings|bonus|salary|paycheck|pay|wages)\b|\b(?:atm|cash machine)\b/

// "I need to save some money" / "I need to earn more cash" is a
// self-directed goal, not a statement of lack — excluded up front.
const NEED_MONEY_PATTERN =
  /\bi need\b(?!\s+to\s+(?:save|earn|make|budget|spend|count|set aside|put aside|put away|manage|withdraw|check|track|cut|reduce|plan)\b).{0,15}\b(money|funds|cash)\b/i

// send/give/lend/pay/buy/transfer/wire ALL have ordinary non-financial
// senses ("send me a photo", "give me your opinion", "lend me that
// book", "pay attention", "buy me a coffee", "transfer me the file",
// "wire up the circuit") — a bare sentence-wide financial term is NOT
// enough for any of them; the term must be LOCALLY tied to the verb
// (see analyzeDirectedRequest below). This pattern only finds the
// verb+object LEAD-IN; it says nothing about whether the object is
// financial.
const LOCAL_TIE_VERB_LEAD_IN_PATTERN =
  /\b(?:can|could|would) you\b.{0,15}\b(?:send|give|lend|pay|buy|transfer|wire)\b(?:\s+me\b)?|\bplease\b.{0,15}\b(?:send|pay|transfer|wire)\b(?:\s+me\b)?|\b(?:send|give|lend|pay|transfer|wire)\b\s+me\b|\bbuy me\b|\bi need you to\b.{0,15}\b(?:send|pay|buy|transfer|wire)\b(?:\s+me\b)?/i

// How far past a local-tie verb's lead-in to look for its financial
// object, before OBJECT_WINDOW_CUTOFF_PATTERN below narrows it further.
// Long enough for "send me $300"/"give me your PayPal", short enough
// that a genuinely later clause won't normally fit even without a
// cutoff match. An approximation, like every other window in this
// file — not an attempt at real clause parsing.
const LOCAL_OBJECT_WINDOW_CHARS = 30

// Marks where the local object window should be cut short: sentence-
// internal punctuation, or a NEW clause describing some other object
// ("...the camera I BOUGHT for $300", "...the file I BOUGHT for
// $300") — the amount after "I bought" describes the unrelated object
// the clause is about, not what the verb's own request is for.
const OBJECT_WINDOW_CUTOFF_PATTERN =
  /[.,!?;]|\bi\s+(?:bought|paid|got|found|saw|ordered|purchased|received|made|had|won|earned|owe|spent)\b/i

// A transfer verb followed closely by "to" and then an actual crypto
// address ("send USDT to 0x...") is unambiguous regardless of whether
// the address is also preceded by a recognizable word like "wallet".
// Only finds the verb+"to" LEAD-IN — sentenceHasDirectedCryptoTransfer
// below then requires the address to appear right where the transfer
// TARGET should be (immediately after "to"), not merely anywhere in
// the sentence: "This article uses 0x... as an example; can you send
// the photo to me?" has both a "send...to" phrase and an address
// somewhere in the sentence, but the address is nowhere near "to".
const TRANSFER_VERB_TO_PATTERN = /\b(send|pay|transfer|wire)\b.{0,20}\bto\b/i

// How far past "to" to look for the actual address — long enough for
// the longest address shape this file recognizes (an EVM address is
// "0x" + 40 hex chars = 42) plus a few filler words ("to the address
// 0x..."), short enough that an address seen much earlier in the
// sentence, before the transfer phrase even started, can't count.
const CRYPTO_TRANSFER_TARGET_WINDOW_CHARS = 50

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
 * (do two facts appear in the same breath?), not for anything
 * requiring linguistic precision. Splitting on the ORIGINAL display
 * text (not canonical/numeric) keeps sentence boundaries stable before
 * any lossy matching-only transformation. */
function splitIntoSentences(displayText: string): string[] {
  return displayText.split(/(?<=[.!?])\s+|\n+/).filter((sentence) => sentence.trim().length > 0)
}

/** A coordinating "and" is also a clause boundary — but only when what
 * follows genuinely reads as a NEW, independent statement rather than
 * a continuation of the same request. Two conservative shapes trigger
 * it:
 *  - a new THIRD-PARTY subject stating an ongoing fact ("and my
 *    brother works at a hospital", "and she lives nearby") — a shift
 *    to describing someone/something else, not the request itself;
 *  - an explicit topic-shift marker, "about <topic>", appearing soon
 *    after "and" ("and let's chat on WhatsApp later about football")
 *    — signals the "and" clause is about something else entirely.
 * Deliberately NOT a bare split on every "and" — "Send me the money
 * and message me on WhatsApp once you've done it." must stay one
 * clause (a second instruction continuing the SAME request), and "I
 * need money because I am in hospital." doesn't even use "and" (a
 * subordinate "because" clause was never split by this file to begin
 * with). */
const CLAUSE_SHIFT_AFTER_AND_PATTERN =
  /\band\b(?=\s+(?:(?:my|his|her|their|our|your)\s+\w+\s+(?:works?|lives?|is|are|was|were|has|does)\b|(?:he|she|they|it)\s+(?:works?|lives?|is|are|was|were|has|does)\b|.{0,40}\babout\b))/i

/** Finer-grained than splitIntoSentences — a single SENTENCE can still
 * contain multiple unrelated CLAUSES ("Could you send me some money,
 * my brother works at a hospital." — one sentence, two unrelated
 * clauses, joined by a comma; "Could you send me some money and my
 * brother works at a hospital." — same thing, joined by "and" instead
 * — see CLAUSE_SHIFT_AFTER_AND_PATTERN). Comma, semicolon, period/!/?,
 * and a qualifying "and" are all treated as clause boundaries
 * identically — which connective a letter happens to use between two
 * facts must never be what decides whether they're related. Used only
 * for composites where even same-SENTENCE co-occurrence was shown to
 * manufacture a false relationship (emergency framing, off-platform
 * escalation, shortener context) — see this file's own "LOCALITY
 * PRINCIPLE" header comment. */
function splitIntoClauses(displayText: string): string[] {
  return displayText
    .split(/(?<=[.!?;,])\s+|\n+/)
    .flatMap((clause) => clause.split(CLAUSE_SHIFT_AFTER_AND_PATTERN))
    .filter((clause) => clause.trim().length > 0)
}

type FinancialTerms = {
  any: boolean
  hasAmount: boolean
  hasCryptoTerm: boolean
  hasCryptoAddress: boolean
  hasGiftCardTerm: boolean
  hasPaymentHandleTerm: boolean
}

const NO_TERMS: FinancialTerms = {
  any: false,
  hasAmount: false,
  hasCryptoTerm: false,
  hasCryptoAddress: false,
  hasGiftCardTerm: false,
  hasPaymentHandleTerm: false,
}

function detectFinancialTerms(canonicalSpan: string, numericSpan: string, displaySpan: string): FinancialTerms {
  const hasAmount =
    testPattern(CURRENCY_SYMBOL_AMOUNT_PATTERN, numericSpan) || testPattern(CURRENCY_WORD_AMOUNT_PATTERN, numericSpan)
  const hasCryptoAddress = testPattern(CRYPTO_ADDRESS_PATTERN, displaySpan)
  const hasCryptoTerm = hasCryptoAddress || CRYPTO_KEYWORD_PATTERN.test(canonicalSpan)
  const hasGiftCardTerm = GIFT_CARD_KEYWORD_PATTERN.test(canonicalSpan)
  const hasPaymentHandleTerm = PAYMENT_HANDLE_KEYWORD_PATTERN.test(canonicalSpan) || testPattern(CASHTAG_PATTERN, displaySpan)
  const hasMoneyWordOrBill = MONEY_WORD_PATTERN.test(canonicalSpan) || LOAN_OR_BILL_PHRASE_PATTERN.test(canonicalSpan)
  return {
    any: hasAmount || hasCryptoTerm || hasGiftCardTerm || hasPaymentHandleTerm || hasMoneyWordOrBill,
    hasAmount,
    hasCryptoTerm,
    hasCryptoAddress,
    hasGiftCardTerm,
    hasPaymentHandleTerm,
  }
}

function mergeTerms(a: FinancialTerms, b: FinancialTerms): FinancialTerms {
  return {
    any: a.any || b.any,
    hasAmount: a.hasAmount || b.hasAmount,
    hasCryptoTerm: a.hasCryptoTerm || b.hasCryptoTerm,
    hasCryptoAddress: a.hasCryptoAddress || b.hasCryptoAddress,
    hasGiftCardTerm: a.hasGiftCardTerm || b.hasGiftCardTerm,
    hasPaymentHandleTerm: a.hasPaymentHandleTerm || b.hasPaymentHandleTerm,
  }
}

/** Length of the local object window starting at `start` in `text`,
 * bounded by LOCAL_OBJECT_WINDOW_CHARS and cut short at the first
 * clause boundary (see OBJECT_WINDOW_CUTOFF_PATTERN). */
function localWindowLength(text: string, start: number): number {
  const rest = text.slice(start, start + LOCAL_OBJECT_WINDOW_CHARS)
  const cutoff = OBJECT_WINDOW_CUTOFF_PATTERN.exec(rest)
  return cutoff ? cutoff.index : rest.length
}

/** "verb...to" plus an address is not enough — the address must be
 * right where the transfer TARGET should be, immediately after "to",
 * not merely present somewhere else in the sentence (see
 * TRANSFER_VERB_TO_PATTERN's doc comment). Checked against DISPLAY
 * text, never canonical — canonicalization's leet-speak pass would
 * corrupt hex digits in the address itself. */
function sentenceHasDirectedCryptoTransfer(displaySentence: string, canonicalSentence: string): boolean {
  const match = TRANSFER_VERB_TO_PATTERN.exec(canonicalSentence)
  if (!match) return false
  const targetStart = match.index + match[0].length
  const targetWindow = displaySentence.slice(targetStart, targetStart + CRYPTO_TRANSFER_TARGET_WINDOW_CHARS)
  return testPattern(CRYPTO_ADDRESS_PATTERN, targetWindow)
}

/** The core locality mechanism: is this ONE sentence a directed money
 * request, and if so, which kinds of financial term (amount, crypto,
 * gift-card, payment-handle) are actually PART OF that same request —
 * never a fact borrowed from elsewhere in the sentence/message that
 * merely happens to co-occur. Each self-contained mechanism (need-
 * money, crypto-transfer-to-address, transfer-to-account) is checked
 * and its terms merged in; the generic local-tie+window mechanism is
 * only consulted if none of the self-contained ones already matched,
 * since it does the most approximate (character-window) binding. */
function analyzeDirectedRequest(
  displaySentence: string,
  canonicalSentence: string,
  numericSentence: string
): FinancialTerms & { isDirected: boolean } {
  let isDirected = false
  let terms = NO_TERMS

  if (NEED_MONEY_PATTERN.test(canonicalSentence) && !NEED_SELF_RESOLVED_PATTERN.test(canonicalSentence)) {
    isDirected = true
    terms = mergeTerms(terms, { ...NO_TERMS, any: true })
  }

  if (sentenceHasDirectedCryptoTransfer(displaySentence, canonicalSentence)) {
    isDirected = true
    terms = mergeTerms(terms, { any: true, hasAmount: false, hasCryptoTerm: true, hasCryptoAddress: true, hasGiftCardTerm: false, hasPaymentHandleTerm: false })
  }

  const transferToAccountMatch = TRANSFER_TO_ACCOUNT_PATTERN.exec(canonicalSentence)
  if (transferToAccountMatch) {
    isDirected = true
    // Bind additional term detection (an amount, a crypto/gift-card
    // mention) to the MATCHED transfer phrase itself, not the whole
    // sentence — "Send the money to my account, I bought my brother a
    // gift card yesterday." must not attach GIFT_CARD_REQUEST just
    // because a gift card is mentioned in a later, unrelated clause.
    // An amount genuinely part of the request ("transfer $500 to my
    // account") already falls within the match itself, since the verb-
    // to-"to" gap allows arbitrary characters in between.
    const matchStart = transferToAccountMatch.index
    const matchEnd = matchStart + transferToAccountMatch[0].length
    const canonicalSpan = canonicalSentence.slice(matchStart, matchEnd)
    const numericSpan = numericSentence.slice(matchStart, matchEnd)
    const displaySpan = displaySentence.slice(matchStart, matchEnd)
    terms = mergeTerms(terms, detectFinancialTerms(canonicalSpan, numericSpan, displaySpan))
  }

  if (!isDirected) {
    const leadIn = LOCAL_TIE_VERB_LEAD_IN_PATTERN.exec(canonicalSentence)
    if (leadIn) {
      if (LOAN_OR_BILL_PHRASE_PATTERN.test(canonicalSentence)) {
        // LOAN_OR_BILL_PHRASE_PATTERN already carries its own internal
        // proximity (a help/pay verb within 25 chars of rent/bill/
        // etc) and is safe to check against the whole sentence —
        // checking only the POST-lead-in window would exclude the
        // "pay"/"help" word the phrase pattern itself needs, since
        // that word was just consumed by the lead-in match above.
        isDirected = true
        terms = mergeTerms(terms, { ...NO_TERMS, any: true })
      } else {
        const objectStart = leadIn.index + leadIn[0].length
        const windowLength = localWindowLength(canonicalSentence, objectStart)
        const canonicalObject = canonicalSentence.slice(objectStart, objectStart + windowLength)
        const displayObject = displaySentence.slice(objectStart, objectStart + windowLength)
        const numericObject = numericSentence.slice(objectStart, objectStart + windowLength)
        const windowTerms = detectFinancialTerms(canonicalObject, numericObject, displayObject)
        if (windowTerms.any) {
          isDirected = true
          terms = mergeTerms(terms, windowTerms)
        }
      }
    }
  }

  return { isDirected, ...terms }
}

function hasInvestmentPromiseLanguageIn(canonicalSpan: string): boolean {
  return INVESTMENT_PROMISE_PATTERN.test(canonicalSpan) && !INVESTMENT_PROMISE_DISCUSSION_PATTERN.test(canonicalSpan)
}

type SentenceAnalysis = {
  isDirectedMoneyRequest: boolean
  hasAmount: boolean
  hasCryptoTerm: boolean
  hasCryptoAddress: boolean
  hasGiftCardTerm: boolean
  hasPaymentHandleTerm: boolean
  isLoanOrBillRequest: boolean
  hasEmergencyTerm: boolean
  hasOffPlatformTerm: boolean
  hasInvestmentPitch: boolean
  hasInvestmentPromise: boolean
  hasUrl: boolean
  hasSuspiciousShortener: boolean
  hasPhishingPhrase: boolean
  hasGiftCardCodeRequest: boolean
}

function analyzeSentence(displaySentence: string): SentenceAnalysis {
  const canonicalSentence = toCanonicalText(displaySentence)
  const numericSentence = toNumericText(displaySentence)
  const directed = analyzeDirectedRequest(displaySentence, canonicalSentence, numericSentence)

  return {
    // Reported speech / negation BEFORE the asking verb ("I told him
    // not to send me money", "Someone asked me for money") describes a
    // request rather than making one.
    isDirectedMoneyRequest: directed.isDirected && !isNotARequest(canonicalSentence),
    hasAmount: directed.hasAmount,
    hasCryptoTerm: directed.hasCryptoTerm,
    hasCryptoAddress: directed.hasCryptoAddress,
    hasGiftCardTerm: directed.hasGiftCardTerm,
    hasPaymentHandleTerm: directed.hasPaymentHandleTerm,
    isLoanOrBillRequest: LOAN_OR_BILL_PHRASE_PATTERN.test(canonicalSentence),
    hasEmergencyTerm: EMERGENCY_KEYWORD_PATTERN.test(canonicalSentence),
    hasOffPlatformTerm: OFF_PLATFORM_KEYWORD_PATTERN.test(canonicalSentence),
    hasInvestmentPitch: INVESTMENT_PITCH_PHRASE_PATTERN.test(canonicalSentence),
    hasInvestmentPromise: hasInvestmentPromiseLanguageIn(canonicalSentence),
    hasUrl: testPattern(URL_PATTERN, displaySentence),
    hasSuspiciousShortener: LINK_SHORTENER_PATTERN.test(displaySentence),
    hasPhishingPhrase: PHISHING_PHRASE_PATTERN.test(canonicalSentence),
    hasGiftCardCodeRequest: GIFT_CARD_CODE_REQUEST_PATTERN.test(canonicalSentence),
  }
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

/** One primary category per confirmed hit, so a single detection is
 * never double-counted as two reason codes (see reason-codes.ts's own
 * note on compounding). Most specific first. */
function primaryCategory(hit: SolicitationHit): 'intermediary' | 'investment' | 'gift_card' | 'crypto' | 'payment' | 'bill' | 'money' {
  if (hit.ask === 'intermediary') return 'intermediary'
  if (hit.ask === 'invest') return 'investment'
  if (hit.kinds.includes('gift_card')) return 'gift_card'
  if (hit.kinds.includes('crypto')) return 'crypto'
  if (hit.kinds.some((k) => k === 'payment_handle' || k === 'bank' || k === 'account')) return 'payment'
  if (hit.kinds.includes('bill') && !hit.kinds.includes('money') && !hit.kinds.includes('amount')) return 'bill'
  return 'money'
}

export function extractIndicators(rawText: string): ExtractedIndicators {
  const solicitation = analyzeSolicitations(rawText)
  const categories = solicitation.hits.map(primaryCategory)
  const displayText = toDisplayText(rawText)
  const canonicalText = toCanonicalText(rawText)
  const numericText = toNumericText(rawText)

  // A quotation introduced by a reporting verb ("She said, 'Can you send
  // me money?'") is a report of a request, not a request.
  const spokenText = stripReportedQuotes(displayText)
  const sentences = splitIntoSentences(spokenText)
  const analyses = sentences.map((sentence) => analyzeSentence(sentence))

  // Finer-grained than sentence-level: emergency framing, off-platform
  // escalation, and shortener context are all checked at CLAUSE
  // granularity, because a single sentence can still join two
  // unrelated facts with a comma ("Could you send me some money, my
  // brother works at a hospital." — one sentence, two clauses). See
  // splitIntoClauses's own doc comment.
  const clauses = splitIntoClauses(spokenText)
  const clauseAnalyses = clauses.map((clause) => analyzeSentence(clause))

  const hasDirectedMoneyRequest = analyses.some((s) => s.isDirectedMoneyRequest)
  const hasDirectedMoneyRequestWithAmount = analyses.some((s) => s.isDirectedMoneyRequest && s.hasAmount)
  const hasDirectedCryptoRequest = analyses.some((s) => s.isDirectedMoneyRequest && s.hasCryptoTerm)
  const hasDirectedCryptoTransfer = analyses.some((s) => s.isDirectedMoneyRequest && s.hasCryptoAddress)
  const hasDirectedGiftCardRequest = analyses.some((s) => s.isDirectedMoneyRequest && s.hasGiftCardTerm)
  const hasDirectedPaymentHandleRequest = analyses.some((s) => s.isDirectedMoneyRequest && s.hasPaymentHandleTerm)
  const hasEmergencyFramedMoneyRequest = clauseAnalyses.some(
    (c) => c.hasEmergencyTerm && (c.isDirectedMoneyRequest || c.isLoanOrBillRequest)
  )
  const hasOffPlatformSolicitation = clauseAnalyses.some(
    (c) => c.hasOffPlatformTerm && (c.isDirectedMoneyRequest || c.hasInvestmentPitch || c.hasInvestmentPromise)
  )
  const hasSolicitationLinkedUrl = analyses.some((s) => s.hasUrl && s.isDirectedMoneyRequest)
  const hasPhishingLinkedUrl = analyses.some((s) => s.hasUrl && s.hasPhishingPhrase)
  // A bare topic mention (PayPal, Bitcoin) is not "genuinely suspicious
  // local context" on its own — only an actual solicitation shape
  // (a directed request, a phishing phrase, or an explicit investment
  // pitch/promise) upgrades a shortener. "I use PayPal and here is the
  // recipe: https://bit.ly/example" must stay weak.
  const hasSuspiciousShortenerWithContext = clauseAnalyses.some(
    (c) => c.hasSuspiciousShortener && (c.isDirectedMoneyRequest || c.hasPhishingPhrase || c.hasInvestmentPitch || c.hasInvestmentPromise)
  )
  // Bound to the SENTENCE the pattern's own internal proximity budgets
  // (up to 40+15 chars between "buy" and "code") could otherwise let it
  // bridge across a full stop — "I bought a Steam gift card. Please
  // send me the code for the front gate." must not read as one scam
  // shape spanning two unrelated sentences.
  const hasGiftCardCodeRequest = analyses.some((s) => s.hasGiftCardCodeRequest)

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
    hasGiftCardCodeRequest,
    hasInvestmentPromiseLanguage: hasInvestmentPromiseLanguageIn(canonicalText),
    hasInvestmentTopicKeyword: INVESTMENT_TOPIC_PATTERN.test(canonicalText),
    hasInvestmentPitchContext: INVESTMENT_PITCH_PHRASE_PATTERN.test(canonicalText),
    hasPaymentHandleKeyword: PAYMENT_HANDLE_KEYWORD_PATTERN.test(canonicalText) || testPattern(CASHTAG_PATTERN, displayText),
    hasBankDetailsSharedPhrase: BANK_DETAILS_SHARED_PATTERN.test(canonicalText),
    hasOffPlatformKeyword: OFF_PLATFORM_KEYWORD_PATTERN.test(canonicalText),
    hasEmergencyKeyword: EMERGENCY_KEYWORD_PATTERN.test(canonicalText),
    hasUrgencyLanguage: URGENCY_LANGUAGE_PATTERN.test(canonicalText),
    hasDirectedMoneyRequest,
    hasDirectedMoneyRequestWithAmount,
    hasDirectedCryptoRequest,
    hasDirectedCryptoTransfer,
    hasDirectedGiftCardRequest,
    hasDirectedPaymentHandleRequest,
    hasEmergencyFramedMoneyRequest,
    hasOffPlatformSolicitation,
    hasSolicitationLinkedUrl,
    hasPhishingLinkedUrl,
    hasSuspiciousShortenerWithContext,
    hasLoanOrBillRequestPhrase: LOAN_OR_BILL_PHRASE_PATTERN.test(canonicalText),
    hasSuspiciousLinkShortener: LINK_SHORTENER_PATTERN.test(displayText),
    hasPhishingPhrase: PHISHING_PHRASE_PATTERN.test(canonicalText),
    solicitedMoney: categories.includes('money'),
    solicitedBillOrLoan: categories.includes('bill'),
    solicitedGiftCard: categories.includes('gift_card'),
    solicitedCrypto: categories.includes('crypto'),
    solicitedPaymentMethod: categories.includes('payment'),
    solicitedIntermediary: categories.includes('intermediary'),
    solicitedInvestment: categories.includes('investment'),
    solicitedWithAmount: solicitation.hits.some((h) => h.hasAmount),
  }
}
