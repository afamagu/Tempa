// Tempa Safety Pattern Library — the COMPOSITIONAL financial-solicitation
// detector.
//
// The previous detector was phrase-shaped: "send me money" was caught,
// while "I have an urgent need for funds. Please help me." was not. This
// module recognises a solicitation from the COMBINATION of
//
//   FINANCIAL NEED / VALUE
//   + DIRECTED ASSISTANCE (a request addressed to the recipient)
//   + optional URGENCY / PAYMENT METHOD / NARRATIVE context
//
// and lets a final, bare request ("Could you?", "Please help me.")
// INHERIT the immediately preceding financial context — but only from the
// previous two sentences of the SAME paragraph, and only when the request
// itself names no object of its own. A request with its own non-financial
// object ("Could you help me choose a gift?") never borrows context, and a
// hardship story with no request is never a solicitation by itself: the
// violation is the ask, not the story.
//
// Talking ABOUT money, prices, hardship, scams or investing is ordinary
// conversation and must stay allowed; reported speech ("Someone asked me
// for money and I said no"), negation ("I told him not to send me
// money"), advice and discussion are guarded explicitly.
//
// Pure and deterministic: no I/O, no external calls, no network. The
// language boundary is ORIGINAL normalized text only today; a future
// privacy-safe translated representation would simply be a second input
// to the same analyzer (see analyzeRepresentations in
// lib/safety/analysis-boundary.ts) — this module never assumes English is
// the only language a member can write in, and never treats "could not
// analyze" as "safe".

import { toDisplayText, toCanonicalText, toNumericText } from '../normalize'
import * as L from './lexicon'

export type FinancialKind =
  | 'money'
  | 'bill'
  | 'amount'
  | 'gift_card'
  | 'crypto'
  | 'payment_handle'
  | 'bank'
  | 'account'
  | 'investment'
  | 'intermediary'

export type AskKind = 'transfer' | 'help' | 'polite' | 'elliptical' | 'intermediary' | 'invest'

export type SolicitationHit = {
  sentenceIndex: number
  ask: AskKind
  kinds: FinancialKind[]
  narratives: L.NarrativeKind[]
  /** The request named no object of its own and inherited the
   * immediately preceding financial context. */
  inherited: boolean
  hasAmount: boolean
}

export type SolicitationFindings = { hits: SolicitationHit[] }

type Sentence = { display: string; paragraph: number }

type Facts = {
  value: boolean
  billLike: boolean
  weakValue: boolean
  amount: boolean
  giftCard: boolean
  crypto: boolean
  paymentHandle: boolean
  bank: boolean
  account: boolean
  need: boolean
  shortFinancial: boolean
  cannotAfford: boolean
  dueDebt: boolean
  lackMoney: boolean
  seeking: boolean
  narratives: L.NarrativeKind[]
}

const BILL_LIKE_PATTERN = /\b(?:bills?|rent|tuition|fees?|debts?|loans?|balance|expenses?|instal+ments?|arrears|charges?|invoice|dues|deposit|mortgage|school fees?)\b/

// ------------------------------------------------------------------
// Preparation
// ------------------------------------------------------------------

/** Spaced-letter runs ("s e n d") are collapsed; words separated by 2+
 * spaces stay separate. */
function collapseSpacedLetters(text: string): string {
  return text.replace(/\b(?:[A-Za-z] ){2,}[A-Za-z]\b/g, (run) => run.replace(/ /g, ''))
}

/** A quotation introduced by a reporting verb ("He wrote 'send me
 * money'") is a report, not a request — replace it so it can't fire. */
export function stripReportedQuotes(text: string): string {
  return text.replace(/["“”](.*?)["“”]/g, (match, _inner, offset: number, whole: string) => {
    const before = whole.slice(Math.max(0, offset - 18), offset)
    return L.REPORTING_VERB_BEFORE_QUOTE.test(before) ? ' ' : match
  })
}

/** "neeed" / "fundsss" / "pleaseee" — for a word with a 3+ letter run,
 * choose whichever collapse yields a word the lexicon cares about. */
function collapseStretches(text: string): string {
  return text.replace(/[a-z]+/gi, (word) => {
    if (!/(.)\1\1/i.test(word)) return word
    const lower = word.toLowerCase()
    const toOne = lower.replace(/(.)\1{2,}/g, '$1')
    const toTwo = lower.replace(/(.)\1{2,}/g, '$1$1')
    // A stretch at the very end is dropped entirely ("pleaseee" ->
    // "please"); a stretch inside a word keeps a natural double ("neeed" -> "need").
    const mixed = lower.replace(/(.)\1{2,}/g, (run, ch: string, offset: number) =>
      offset + run.length >= lower.length ? ch : ch + ch
    )
    for (const candidate of [toOne, toTwo, mixed]) {
      if (L.STRETCH_TARGETS.has(candidate)) return candidate
    }
    return toTwo
  })
}

/** Amounts and cashtags become single tokens BEFORE canonicalisation,
 * because canonicalisation deliberately rewrites '$' and digits into
 * letters — fine for words, destructive for "$200". */
function tokenizeValues(numeric: string): string {
  const globalAmount = new RegExp(L.AMOUNT_PATTERN.source, 'gi')
  return numeric
    .replace(globalAmount, ' amountx ')
    .replace(/\$[a-zA-Z][a-zA-Z0-9_]{2,}\b/g, ' cashtagx ')
    .replace(/\${2,}|[💰💵💸]+/gu, ' money ')
}

function prepare(display: string): string {
  const cleaned = stripReportedQuotes(collapseSpacedLetters(display)).replace(/[’‘`]/g, "'")
  let c = collapseStretches(toCanonicalText(tokenizeValues(toNumericText(cleaned))))
  c = c
    .replace(/\bu\b/g, 'you')
    .replace(/\bur\b/g, 'your')
    .replace(/\b(?:pls|plz|pleez)\b/g, 'please')
    .replace(/\bim\b/g, "i'm")
    .replace(/\bdont\b/g, "don't")
    .replace(/\bcant\b/g, "can't")
    .replace(/\bcud\b/g, 'could')
    .replace(/\bwud\b/g, 'would')
  return c
}

function splitSentences(rawText: string): Sentence[] {
  const display = toDisplayText(rawText)
  const sentences: Sentence[] = []
  const paragraphs = display.split(/\n\s*\n/)
  paragraphs.forEach((paragraph, paragraphIndex) => {
    for (const part of paragraph.split(/(?<=[.!?])\s+|\n+/)) {
      if (part.trim().length > 0) sentences.push({ display: part, paragraph: paragraphIndex })
    }
  })
  return sentences
}

// ------------------------------------------------------------------
// Fact extraction
// ------------------------------------------------------------------

function factsOf(c: string): Facts {
  const narratives = (Object.keys(L.NARRATIVE_PATTERNS) as L.NarrativeKind[]).filter((k) => L.NARRATIVE_PATTERNS[k].test(c))
  return {
    value: L.VALUE_STRONG_PATTERN.test(c) || L.FINANCIAL_HELP_PATTERN.test(c) || L.VALUE_PHRASE_PATTERN.test(c),
    billLike: BILL_LIKE_PATTERN.test(c),
    weakValue: L.VALUE_WEAK_PATTERN.test(c),
    amount: /\bamountx\b/.test(c),
    giftCard: L.GIFT_CARD_PATTERN.test(c),
    crypto: L.CRYPTO_PATTERN.test(c),
    paymentHandle: L.PAYMENT_APP_PATTERN.test(c) || /\bcashtagx\b/.test(c),
    bank: L.BANK_TRANSFER_PATTERN.test(c),
    account: L.YOUR_ACCOUNT_PATTERN.test(c),
    need: L.NEED_FRAME_PATTERN.test(c),
    shortFinancial: L.SHORT_FINANCIAL_PATTERN.test(c),
    cannotAfford: L.CANNOT_AFFORD_PATTERN.test(c),
    dueDebt: L.DUE_DEBT_PATTERN.test(c),
    lackMoney: L.LACK_MONEY_PATTERN.test(c) || L.FINANCIAL_BIND_PATTERN.test(c),
    seeking: L.SEEKING_VALUE_PATTERN.test(c),
    narratives,
  }
}

function hasFinancialObject(f: Facts): boolean {
  return f.value || f.amount || f.giftCard || f.crypto || f.paymentHandle || f.bank || f.account
}

/** Does this sentence, on its own, establish that the WRITER is in
 * financial need / owes / cannot pay? This is context a later bare
 * request may inherit; it is never a violation by itself. */
function financialNeedContext(f: Facts): boolean {
  if (f.need && (hasFinancialObject(f) || f.weakValue)) return true
  if (f.dueDebt && (f.value || f.amount || f.billLike || f.weakValue)) return true
  if (f.shortFinancial || f.lackMoney || f.seeking) return true
  if (f.cannotAfford && (hasFinancialObject(f) || f.weakValue)) return true
  return false
}

function kindsOf(f: Facts, c: string): FinancialKind[] {
  const kinds = new Set<FinancialKind>()
  if (f.amount) kinds.add('amount')
  if (f.giftCard) kinds.add('gift_card')
  if (f.crypto) kinds.add('crypto')
  if (f.paymentHandle) kinds.add('payment_handle')
  if (f.bank) kinds.add('bank')
  if (f.account) kinds.add('account')
  if (f.billLike && (f.value || f.dueDebt || f.need || f.cannotAfford || /\b(?:pay|cover|settle|clear)\b/.test(c))) kinds.add('bill')
  if (f.value && !f.billLike) kinds.add('money')
  if (f.value && f.billLike && /\b(?:money|cash|funds?|financial)\b/.test(c)) kinds.add('money')
  return Array.from(kinds)
}

// ------------------------------------------------------------------
// Ask detection
// ------------------------------------------------------------------

type Ask = { kind: AskKind; start: number; end: number; helpVerb: boolean; verb: string }

const HELP_VERBS = /^(?:help|assist|support|do anything|do something|sort|arrange|save|rescue|bail|help out)$/

function detectAsk(c: string): Ask | null {
  const candidates: Ask[] = []

  const modal = L.MODAL_ASK_PATTERN.exec(c)
  if (modal) {
    const verb = /(?:help out|do anything|do something|top[ -]up|send over|wire over|chip in|[a-z]+)$/.exec(modal[0])?.[0] ?? ''
    candidates.push({ kind: HELP_VERBS.test(verb) ? 'help' : 'transfer', start: modal.index, end: modal.index + modal[0].length, helpVerb: HELP_VERBS.test(verb), verb })
  }
  const polite = L.POLITE_ASK_PATTERN.exec(c)
  if (polite) candidates.push({ kind: 'polite', start: polite.index, end: polite.index + polite[0].length, helpVerb: false, verb: '' })
  const please = L.PLEASE_ASK_PATTERN.exec(c)
  if (please) {
    const verb = /[a-z]+(?: out| anything| something)?$/.exec(please[0])?.[0] ?? ''
    const help = /^(?:help|assist|support|sort|do something)/.test(verb)
    candidates.push({ kind: help ? 'help' : 'transfer', start: please.index, end: please.index + please[0].length, helpVerb: help, verb: verb.trim() })
  }
  const helpMe = L.HELP_ME_PATTERN.exec(c)
  if (helpMe && !L.GRATITUDE_PATTERN.test(c)) {
    candidates.push({ kind: 'help', start: helpMe.index, end: helpMe.index + helpMe[0].length, helpVerb: true, verb: 'help' })
  }
  const elliptical = L.ELLIPTICAL_ASK_PATTERN.exec(c)
  if (elliptical) candidates.push({ kind: 'elliptical', start: elliptical.index, end: elliptical.index + elliptical[0].length, helpVerb: true, verb: 'help' })
  const borrow = L.BORROW_ASK_PATTERN.exec(c)
  if (borrow) candidates.push({ kind: 'polite', start: borrow.index, end: borrow.index + borrow[0].length, helpVerb: false, verb: 'borrow' })

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.start - b.start)
  return candidates[0]
}

const FILLER_WORDS = new Set(
  'me us out please kindly with this that it some any of a an little bit today now soon asap quickly urgently immediately again too for to sort cover pay help assist support the rest part half i am really so much just if you can could would will might and or but then ok okay thanks thank yes sure maybe them these those anything something get through by'.split(
    ' '
  )
)

function isObjectless(rest: string): boolean {
  const words = rest.toLowerCase().match(/[a-z']+/g) ?? []
  const leftover = words.filter((w) => !FILLER_WORDS.has(w))
  return leftover.length <= 1
}

const OBJECT_WINDOW_CHARS = 70
const OBJECT_CUTOFF = /[!?;]|(?<!\d)[.,]|[.,](?!\d)|\bi\s+(?:bought|paid|got|found|saw|ordered|purchased|received|made|had|won|earned|owe|spent)\b/

function objectWindow(c: string, from: number, helpVerb: boolean): string {
  const rest = c.slice(from, from + OBJECT_WINDOW_CHARS)
  if (helpVerb) return rest
  const cut = OBJECT_CUTOFF.exec(rest)
  return cut ? rest.slice(0, cut.index) : rest
}

/** Reported speech ("Someone asked me for money") and negation ("I told
 * him not to send me money") only neutralise an ask when they come BEFORE
 * it — "Please send me money, my brother told me to ask you" is still an
 * ask, and so is "Please send me money, don't ask why". */
export function isNotARequest(c: string, askStart?: number, askEnd?: number): boolean {
  const position = askStart ?? c.search(FIRST_ASK_VERB)
  if (position < 0) return false
  const reported = L.REPORTED_ASK_PATTERN.exec(c)
  if (reported && reported.index < position) return true
  const negated = L.NEGATED_ASK_PATTERN.exec(c)
  // The negation must begin before the asking verb is finished, and its
  // own span must reach the ask ("not to send", "never lend") — a
  // negation that only appears AFTER the ask ("send me money, don't ask
  // why") leaves the ask standing.
  return negated !== null && negated.index < (askEnd ?? position + 1) && negated.index + negated[0].length > position
}


const FIRST_ASK_VERB = /\b(?:send|give|lend|loan|pay|transfer|wire|help|spare|donate|need|borrow|forward|buy|cover)\b/

function guardedOut(c: string, ask: Ask): boolean {
  return isNotARequest(c, ask.start, ask.end)
}

// ------------------------------------------------------------------
// Main analysis
// ------------------------------------------------------------------

const INHERIT_LOOKBACK_SENTENCES = 2
const INHERIT_MAX_CHARS = 320

export function analyzeSolicitations(rawText: string): SolicitationFindings {
  const sentences = splitSentences(rawText)
  const prepared = sentences.map((s) => prepare(s.display))
  const facts = prepared.map((c) => factsOf(c))
  const hits: SolicitationHit[] = []

  sentences.forEach((sentence, i) => {
    const c = prepared[i]
    const f = facts[i]

    // --- intermediary / money-mule behaviour ---
    if (
      !isNotARequest(c) &&
      L.INTERMEDIARY_PATTERNS.some((p) => p.test(c))
    ) {
      hits.push({ sentenceIndex: i, ask: 'intermediary', kinds: ['intermediary', ...kindsOf(f, c)], narratives: f.narratives, inherited: false, hasAmount: f.amount })
    }

    // --- investment solicitation aimed at the recipient ---
    const investDirected =
      L.INVEST_SHOW_PATTERN.test(c) ||
      (L.INVEST_DIRECTIVE_PATTERN.test(c) && (L.INVEST_SENDER_TIE_PATTERN.test(c) || L.INVEST_INTO_PATTERN.test(c)))
    if (investDirected && !isNotARequest(c)) {
      hits.push({ sentenceIndex: i, ask: 'invest', kinds: ['investment', ...kindsOf(f, c)], narratives: f.narratives, inherited: false, hasAmount: f.amount })
    }

    // --- a payment destination handed to the recipient ("send it to my
    // PayPal", "Venmo me") and an amount-specific invest ask ---
    const destinationMatch = L.PAYMENT_DESTINATION_PATTERN.exec(c) ?? L.PAYMENT_APP_VERB_PATTERN.exec(c)
    const investAsk = f.amount && L.INVEST_ASK_PATTERN.test(c) && L.INVEST_TIE_PATTERN.test(c)
    if ((destinationMatch || investAsk) && !isNotARequest(c)) {
      // Evidence is bound to the MATCHED span, not the whole sentence:
      // "Send the money to my account, I bought my brother a gift card"
      // is a money ask, not a gift-card ask.
      const span = destinationMatch ? factsOf(destinationMatch[0]) : f
      hits.push({
        sentenceIndex: i,
        ask: investAsk && !destinationMatch ? 'invest' : 'transfer',
        kinds: kindsOf(span, destinationMatch ? destinationMatch[0] : c),
        narratives: f.narratives,
        inherited: false,
        hasAmount: span.amount,
      })
    }

    // --- stray-space evasion ("mone y"): imperative/modal opener only ---
    if (
      L.SQUASHED_ASK_PATTERN.test(c.replace(/\s+/g, '')) &&
      !isNotARequest(c)
    ) {
      hits.push({ sentenceIndex: i, ask: 'transfer', kinds: ['money'], narratives: f.narratives, inherited: false, hasAmount: f.amount })
    }

    // --- directed assistance ---
    const ask = detectAsk(c)
    if (!ask || guardedOut(c, ask)) return
    if (ask.helpVerb && L.HELP_NONFINANCIAL_OBJECT_PATTERN.test(c.slice(ask.start))) return

    const window = objectWindow(c, ask.end, ask.helpVerb)
    const windowFacts = factsOf(window)

    // Own object first: the request itself names something financial.
    // Help-type asks may also be tied to a financial object elsewhere in
    // the SAME sentence ("For $50, could you help?"); transfer-type asks
    // must tie it locally (send/give/pay have ordinary non-financial
    // senses — "send me a photo of the camera I bought for $300").
    const acquire = L.ACQUIRE_VERB_PATTERN.test(ask.verb)
    const objectOk = acquire
      ? (f2: Facts) => f2.giftCard || f2.crypto || f2.paymentHandle || f2.bank || f2.value
      : hasFinancialObject
    const ownObject = objectOk(windowFacts) || (ask.helpVerb && objectOk(f) && !isObjectless(window))
    if (ownObject) {
      const scope = ask.helpVerb ? f : windowFacts
      hits.push({
        sentenceIndex: i,
        ask: ask.kind,
        kinds: kindsOf(scope, c),
        narratives: Array.from(new Set([...f.narratives, ...windowFacts.narratives])),
        inherited: false,
        hasAmount: scope.amount,
      })
      return
    }

    // A request with no object of its own may inherit the immediately
    // preceding financial NEED context — and nothing further away.
    if (!isObjectless(window)) return
    let distance = 0
    for (let back = 1; back <= INHERIT_LOOKBACK_SENTENCES && i - back >= 0; back++) {
      const j = i - back
      if (sentences[j].paragraph !== sentence.paragraph) break
      distance += sentences[j].display.length
      if (distance > INHERIT_MAX_CHARS) break
      if (financialNeedContext(facts[j])) {
        const kinds = kindsOf(facts[j], prepared[j])
        hits.push({
          sentenceIndex: i,
          ask: ask.kind,
          kinds: kinds.length > 0 ? kinds : ['money'],
          narratives: Array.from(new Set([...facts[j].narratives, ...f.narratives])),
          inherited: true,
          hasAmount: facts[j].amount,
        })
        return
      }
    }
  })

  return { hits: dedupe(hits) }
}

function dedupe(hits: SolicitationHit[]): SolicitationHit[] {
  const seen = new Set<string>()
  return hits.filter((h) => {
    const key = `${h.sentenceIndex}|${h.ask}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Convenience projections used by indicators.ts. */
export function anyDirectedAssistance(findings: SolicitationFindings): boolean {
  return findings.hits.some((h) => h.ask !== 'intermediary' && h.ask !== 'invest')
}
