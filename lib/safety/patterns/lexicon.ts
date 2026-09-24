// Tempa Safety Pattern Library — LEXICON.
//
// Categories of MEANING, kept as small word families rather than long
// phrase lists. lib/safety/patterns/solicitation.ts composes them
// (financial need/value + directed assistance + recipient direction +
// optional narrative/payment-method context) so a solicitation is
// recognised by what it DOES, not by one magic phrase like "send me
// money". Tempa owns and maintains this vocabulary; the regression
// corpus that exercises it is synthetic (lib/safety/patterns/
// solicitation.corpus.ts) and was written from public scam-category
// descriptions (FTC / FBI / eSafety style categories), never copied
// from a third-party corpus.
//
// All word-level patterns run against PREPARED text (see prepare() in
// solicitation.ts): NFKC + zero-width/homoglyph/leet folded by
// normalize.ts's toCanonicalText, lowercased, apostrophes unified, and
// a few chat contractions expanded (u -> you, pls -> please, ur ->
// your). Amounts run against normalize.ts's numeric text instead,
// because canonicalisation deliberately rewrites digits and '$'.

// ---------------------------------------------------------------
// Financial VALUE
// ---------------------------------------------------------------

/** Nouns that are financial on their own. */
export const VALUE_STRONG_PATTERN =
  /\b(?:money|monies|cash|funds?|payments?|donations?|contributions?|loans?|debts?|fees?|bills?|rent|tuition|deposit|instal+ments?|arrears|expenses?|capital)\b/

/** "financial" is only value-bearing next to a help/need noun. */
export const FINANCIAL_HELP_PATTERN =
  /\bfinancial(?:ly)?\s+(?:help|support|assistance|aid|situation|trouble|difficult\w*|hardship|crisis|emergency|problems?|constraints?|burden|relief|need)\b/

/** Weakly financial nouns — only count when a NEED or DUE frame is
 * also present (see financialNeedContext). */
export const VALUE_WEAK_PATTERN = /\b(?:costs?|prices?|tickets?|fares?|airfare|flights?|surgery|treatment|medication|hospital|clearance|customs|duty|duties|shipping|shipment|parcel|package|visa|permit)\b/

const NUMBER_WORD =
  '(?:a|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|eleven|twelve|fifteen|hundred|hundreds|thousand|thousands|million|billion|few|couple of|some|several|dozens?)'
const CURRENCY_WORD =
  '(?:dollars?|usd|bucks|euros?|eur|pounds?|gbp|quid|naira|ngn|cedis?|ghs|rand|zar|shillings?|kes|rupees?|inr|pesos?|yuan|rmb|cad|aud)'
const CRYPTO_UNIT_WORD = '(?:btc|eth|usdt|bitcoins?|ethereum|tether)'

/** Runs against NUMERIC text (digits/currency symbols intact). */
export const AMOUNT_PATTERN = new RegExp(
  String.raw`(?:[$€£₦₹¥₵₩]\s?\d[\d,]*(?:\.\d+)?\s?k?\b)|(?:\b\d[\d,]*(?:\.\d+)?\s?k?\s?(?:${CURRENCY_WORD}|${CRYPTO_UNIT_WORD})\b)|(?:\b${NUMBER_WORD}\b(?:[\s-]+(?:${NUMBER_WORD}|and))*[\s-]+${CURRENCY_WORD}\b)`,
  'i'
)

// ---------------------------------------------------------------
// Payment METHODS / instruments
// ---------------------------------------------------------------

export const GIFT_CARD_PATTERN = /\b(?:gift ?cards?|steam cards?|google play cards?|itunes cards?|amazon cards?|apple cards?|redeem codes?|voucher codes?|prepaid cards?)\b/
export const CRYPTO_PATTERN = /\b(?:bitcoin|btc|ethereum|eth|usdt|tether|crypto(?:currency)?|binance|blockchain|metamask|wallet address|usdc|solana|litecoin|doge(?:coin)?)\b/
export const PAYMENT_APP_PATTERN = /\b(?:paypal|cash ?app|venmo|zelle|western union|moneygram|remitly|wise transfer|mpesa|m-pesa|opay|paystack|flutterwave|chipper)\b/
export const CASHTAG_PATTERN = /\$[a-zA-Z][a-zA-Z0-9_]{2,}\b/
export const BANK_TRANSFER_PATTERN = /\b(?:bank transfer|wire transfer|wire|swift|iban|routing number|account number|bank details|bank account|sort code)\b/
/** "your account / your paypal / your wallet" — the RECIPIENT's own
 * financial instrument being asked for. */
export const YOUR_ACCOUNT_PATTERN = /\byour\s+(?:(?:bank|paypal|cash ?app|venmo|zelle|crypto|bitcoin)\s+)?(?:account|wallet|card|paypal|cash ?app|venmo|zelle)\b/

// ---------------------------------------------------------------
// NEED — first-person lack / hardship framing
// ---------------------------------------------------------------

/** "need to save/earn/make ..." is a self-directed goal, not a lack. */
const SELF_DIRECTED_NEED = String.raw`(?:\s+to\s+(?:save|earn|make|budget|spend|count|set aside|put aside|put away|manage|withdraw|check|track|cut|reduce|plan))`

export const NEED_FRAME_PATTERN = new RegExp(
  String.raw`\b(?:i|we)(?:\s+(?:really|urgently|desperately|just|still|only|now|currently|also|so|truly|badly|do|did))*\s+(?:need|needed|needing|require|required)\b(?!${SELF_DIRECTED_NEED})` +
    String.raw`|\b(?:urgent|immediate|pressing|desperate|dire|great|serious)\s+(?:need|requirement)\b` +
    String.raw`|\bin\s+(?:urgent |desperate |dire |great |serious )?need\s+of\b` +
    String.raw`|\b(?:i|we)(?:'m|\s+am|'re|\s+are)\s+(?:currently |really |a bit |a little |so |quite )?(?:short|struggling|stuck|desperate|broke|behind|stranded|in (?:trouble|a bind|a tough spot|a difficult (?:spot|situation)|financial trouble))\b` +
    String.raw`|\bran out of\b|\b(?:i|we)\s+(?:only |just |still )?(?:lack|owe)\b`
)

export const SHORT_FINANCIAL_PATTERN =
  /\bshort\s+(?:of|on)\s+(?:cash|money|funds|rent|the rent)\b|\bshort\s+until\s+(?:payday|friday|monday|tuesday|wednesday|thursday|saturday|sunday|next week|the end of the month|month end|then|tomorrow)\b|\bshort\s+this\s+(?:week|month)\b/

export const CANNOT_AFFORD_PATTERN =
  /\b(?:can'?t|cannot|can not|couldn'?t|could not|unable to|not able to|struggl\w+ to|failed to|didn'?t manage to)\s+(?:afford|pay|cover|settle|clear|meet|raise|find|make)\b/

export const DUE_DEBT_PATTERN =
  /\b(?:is|are|was|were|remains?|remaining|still|now)?\s*(?:due|overdue|unpaid|outstanding|owing|pending|late|behind|delinquent)\b|\b(?:i|we)\s+owe\b|\bowe\s+(?:the|my|a|some|\$)\b/

// ---------------------------------------------------------------
// DIRECTED ASSISTANCE — asks addressed to the recipient
// ---------------------------------------------------------------

const ASK_VERBS =
  'buy|purchase|get|order|pick up|help|assist|support|lend|loan|spot|cover|contribute|chip in|send|transfer|wire|pay|give|donate|front|spare|forward|deposit|do anything|do something|sort|arrange|bail|rescue|save|advance|fund|finance|sponsor|top up|top-up|send over|wire over|help out'

/** can/could/would/will you [(please)] [verb] ... */
export const MODAL_ASK_PATTERN = new RegExp(
  String.raw`\b(?:can|could|would|will|might|may|do|did)\s+you\b(?:\s+(?:please|kindly|maybe|possibly|perhaps|just|even|still|somehow|at all|be able to|manage to|find a way to))*\s+(?:${ASK_VERBS})\b`
)

/** "Can you?" / "Could you please?" — the request has no stated verb. */
export const ELLIPTICAL_ASK_PATTERN = /\b(?:can|could|would|will|might)\s+you(?:\s+(?:please|kindly|maybe))?\s*[?!.…]*\s*$/

export const POLITE_ASK_PATTERN = new RegExp(
  String.raw`\b(?:(?:please )?(?:don'?t|do not) (?:hesitate|be (?:afraid|shy|embarrassed)) to|would you mind|do you think you (?:can|could|might)|is there (?:any|a) way you (?:can|could|might)|any chance you (?:can|could|might)|i was (?:hoping|wondering|thinking) (?:if )?you (?:can|could|might|would)|i wonder if you (?:can|could|might|would)|i(?:'d| would) (?:really |truly |so |very much )?(?:appreciate|love)(?: it)?(?: so much)? if you|i(?:'d| would) be (?:so |very |truly |extremely )?grateful (?:if you|for)|would you be able to|would you be (?:willing|so kind|kind enough|open) to|would you consider|will you be (?:willing|able) to|are you able to|are you in a position to|are you willing to|is it possible for you to|if you (?:can|could)(?: only)?|if you are able to|can you find it in you to|do you have (?:any way|a way) to)\b`
)

export const PLEASE_ASK_PATTERN = new RegExp(
  String.raw`\b(?:please|kindly|pls|plz)\b[\s,]*(?:${ASK_VERBS})\b|^\s*(?:(?:please|kindly|just|then|now|simply)[\s,]+)*(?:buy|purchase|get|order|send|transfer|wire|lend|loan|pay|cover|donate|contribute|give|spot|forward|deposit|advance|top up)\b`
)

export const HELP_ME_PATTERN =
  /\bhelp me(?: out| sort| with| cover| pay| get| raise| find| settle| clear| meet| fund)?\b|\b(?:your|any|some|a little|a bit of|financial|urgent|little)\s+(?:help|support|assistance|aid|favou?r)\b|\bi(?: am|'m)\s+(?:asking|begging|pleading|reaching out|writing)\b|\bi have a favou?r to ask\b|\bi need you to\b|\bi need your\b/

/** Gratitude / thanks — "thanks for your help" is not an ask. */
export const GRATITUDE_PATTERN = /\b(?:thank(?:s| you)|thankful|grateful|appreciate[d]?)\b.{0,30}\b(?:your|the)\s+(?:help|support|assistance|kindness)\b/

/** Help with a clearly NON-financial object — never a solicitation. */
export const HELP_NONFINANCIAL_OBJECT_PATTERN =
  /\bhelp(?:\s+me)?\s+(?:to\s+)?(?:with\s+)?(?:understand\w*|learn\w*|study\w*|practi[cs]e|write|writing|choose|find|pick|translate|translation|proofread|edit|plan|decide|decision|move|moving|cook\w*|recipe|homework|essay|garden\w*|cv|resume|application|research|project|english|french|spanish|german|grammar|pronunciation|poem|story|letter|photo|photos|picture|pictures|music|song|book|books|game|puzzle|trip|itinerary|name|names|idea|ideas|advice|opinion)\b/

// ---------------------------------------------------------------
// GUARDS — reported speech, negation, discussion
// ---------------------------------------------------------------

/** Negation directly attached to the asking verb ("don't send me
 * money", "not to send me anything", "you never need to send money"). */
export const NEGATED_ASK_PATTERN =
  /\b(?:don'?t|do not|never|not|no need to|need not|shouldn'?t|should not|wouldn'?t|won'?t|will not|please don'?t|stop)\b(?!\s+(?:hesitate|forget|delay|be (?:shy|afraid|embarrassed)|fail|worry))\s.{0,22}\b(?:send|give|lend|pay|transfer|wire|help|ask|donate|loan|spare|forward)\b/

/** Reported / third-party asking: someone ELSE asked (or scammers do). */
export const REPORTED_ASK_PATTERN =
  /\b(?:someone|somebody|he|she|they|people|scammers?|fraudsters?|strangers?|men|man|woman|guy|guys|my (?:brother|sister|friend|mother|father|mum|mom|dad|boss|landlord|neighbou?r|cousin|uncle|aunt)|the (?:bank|landlord|company))\b.{0,30}\b(?:asked|asks|ask|asking|begged|begs|told|tells|wants?|wanted|demanded|demands|requested|requests|claims?|claimed|said|says|tried|try|trying)\b/

/** A reporting verb immediately before a quotation. */
export const REPORTING_VERB_BEFORE_QUOTE = /(?:said|says|wrote|writes|texted|messaged|asked|told|emailed|claimed|replied|read|reads|sent me)\W{0,6}$/i

// ---------------------------------------------------------------
// NARRATIVES — scam-story SIGNALS (never violations by themselves)
// ---------------------------------------------------------------

export const NARRATIVE_PATTERNS = {
  medical: /\b(?:hospital(?:ized|ised)?|surgery|operation|medical|medication|treatment|doctor|clinic|ill(?:ness)?|sick|cancer|dialysis|diagnos\w+)\b/,
  travel: /\b(?:stranded|airfare|air ticket|flight|ticket|airport|boarding|travel|trip|visa|passport|deported|immigration)\b/,
  legal_visa: /\b(?:visa|immigration|permit|lawyer|attorney|legal fees?|court|bail|fine|lawsuit|tax(?:es)?|clearance certificate)\b/,
  customs_business: /\b(?:customs|shipment|parcel|package|cargo|import|export|container|contract|supplier|business deal|consignment|delivery fee|clearing)\b/,
  debt_housing_tuition: /\b(?:rent|landlord|eviction|mortgage|tuition|school fees?|fees|debt|loan|bills?|electricity|utilities|arrears)\b/,
  fees: /\b(?:release fee|processing fee|clearance fee|handling fee|activation fee|admin(?:istration)? fee|transfer fee|insurance fee|unlock fee)\b/,
  windfall: /\b(?:inheritance|inherited|beneficiary|lottery|prize|winnings?|unclaimed|estate|will)\b/,
  emergency: /\b(?:emergency|urgent(?:ly)?|accident|robbed|stolen|mugged|attacked|kidnapp?ed|arrested|detained|desperate)\b/,
  investment: /\b(?:invest\w*|forex|trading|opportunity|returns?|profit|scheme|platform)\b/,
} as const

export type NarrativeKind = keyof typeof NARRATIVE_PATTERNS

// ---------------------------------------------------------------
// INTERMEDIARY / money-mule behaviour
// ---------------------------------------------------------------

export const INTERMEDIARY_PATTERNS: RegExp[] = [
  /\b(?:receive|accept|collect|get|hold|keep|store|park|deposit)\b.{0,25}\b(?:money|payments?|funds?|cash|cheques?|checks?|transfers?|wires?)\b.{0,20}\b(?:for me|on my behalf)\b/,
  /\b(?:let me|allow me to|can i|could i|may i|would you let me|will you let me|i(?:'d| would) like to|i want to|i need to)\b.{0,18}\b(?:use|borrow)\b.{0,15}\byour\b.{0,15}\b(?:account|wallet|paypal|cash ?app|venmo|zelle|card)\b/,
  /\bforward\b.{0,20}\b(?:the |this |that |it |my )?(?:money|payments?|funds?|cash)\b/,
  /\b(?:cash|deposit|transfer|wire|send|forward)\b.{0,22}\b(?:this|the|a|my)\b.{0,12}\b(?:cheque|check|money order|payment|funds|money)\b.{0,28}\b(?:for me|on my behalf|and (?:send|forward|give|wire|transfer))\b/,
  /\buse your\b.{0,12}\baccount\b.{0,30}\b(?:receive|for|to (?:receive|get|hold|collect))\b/,
  /\b(?:receive|accept|collect)\b.{0,15}\b(?:the |this |a |my )?(?:money|payment|funds|transfer)\b.{0,25}\b(?:into|in|through|via|using)\b.{0,10}\byour\b/,
]

// ---------------------------------------------------------------
// INVESTMENT solicitation aimed at the recipient
// ---------------------------------------------------------------

/** A directive addressed to the recipient. */
export const INVEST_DIRECTIVE_PATTERN =
  /\b(?:you (?:should|can|could|must|need to|have to|ought to|will|might want to)|please|kindly|why don'?t you|let'?s|come and|join (?:me|us)(?: and)?)\b.{0,15}\b(?:invest|put|deposit|place|send|buy into|join|start)\b/
/** "...with me / my / our / this platform ..." — the destination is
 * tied to the SENDER, which is what separates a pitch from generic
 * investing advice ("you should invest in index funds"). */
export const INVEST_SENDER_TIE_PATTERN =
  /\b(?:my|our|this|that|with me|with us|through me|via me|the platform i|the (?:same )?platform|i (?:use|trade|work|run|manage|started))\b.{0,40}\b(?:investment|platform|scheme|opportunity|fund|trading|forex|crypto|bitcoin|business|project|company|app)\b|\b(?:investment|platform|scheme|opportunity|fund|forex)\b.{0,25}\b(?:with me|with us|through me|via me|i (?:use|trade|run))\b/
/** "I can show you where/how to put $500 into ..." */
export const INVEST_SHOW_PATTERN =
  /\b(?:show|teach|tell|help)(?:\s+you)?\b.{0,20}\b(?:where|how)\b.{0,15}\b(?:to )?(?:put|invest|deposit|place|turn)\b.{0,30}(?:amountx|money|funds|savings)/
export const INVEST_INTO_PATTERN =
  /\b(?:put|invest|deposit|place|send)\b.{0,15}(?:amountx|some of your money|your money|your savings|funds)\b.{0,25}\b(?:into|in|with|on)\b.{0,20}\b(?:this|my|our|the)\b.{0,15}\b(?:investment|platform|trade|trading|scheme|fund|opportunity|business|project|company|crypto|forex)\b/

// ---------------------------------------------------------------
// Additional need / seeking / destination frames
// ---------------------------------------------------------------

/** Inherently financial statements of lack — need no other object. */
export const LACK_MONEY_PATTERN =
  /\b(?:no|not enough|without|out of|ran out of|running out of|low on)\s+(?:money|cash|funds)\b|\b(?:don'?t|do not|didn'?t|did not|doesn'?t) have (?:any |enough |much )?(?:money|cash|funds)\b|\b(?:i|we)(?:'m|\s+am|'re|\s+are)\s+(?:completely |totally |flat |really |very |so )?(?:broke|penniless|bankrupt|in debt|in the red)\b|\bin an? (?:financial|money|cash)\s+(?:emergency|crisis|trouble|difficulty|bind|hardship|situation|mess)\b|\b(?:i|we)(?:'m|\s+am|'re|\s+are)\s+(?:currently |really )?(?:facing|going through|having)\s+(?:a |an )?(?:financial|money|cash)\b/

/** "I asked my bank for a loan and they said no" — the writer sought
 * value elsewhere; a bare follow-up ask inherits this. */
export const SEEKING_VALUE_PATTERN =
  /\b(?:i|we)\s+(?:asked|applied|tried|went|begged|approached|looked)\b.{0,35}\b(?:for|to get)\b.{0,15}\b(?:a loan|loans?|money|funds|help|credit|financing|financial help|cash)\b/

/** "send it to my PayPal", "put it into my account" — a payment
 * destination handed to the recipient, with a directive subject. */
export const PAYMENT_DESTINATION_PATTERN =
  /(?:^|\b(?:you (?:can|could|may|should|must|need to|will|just)|please|kindly|just)\b\s*)(?:send|transfer|wire|pay|deposit|put|drop|forward|remit)\b.{0,30}\b(?:to|into|via|through|on|using|in)\s+(?:my|our)\s+(?:[a-z]+ ){0,2}(?:paypal|cash ?app|cashtagx|venmo|zelle|bank|account|wallet|card|mpesa|m-pesa|opay|western union|moneygram)\b/

/** "Venmo me", "PayPal me", "Zelle me" — the app used as the verb. */
export const PAYMENT_APP_VERB_PATTERN =
  /\b(?:venmo|paypal|zelle|cash ?app|cashapp|western union)\s+(?:me|us)\b/

/** An invest-verb directed at the recipient. */
export const INVEST_ASK_PATTERN = /\b(?:can|could|would|will|please|kindly)\b.{0,12}\b(?:invest|put|deposit|place)\b/
export const INVEST_TIE_PATTERN = /\b(?:in|into|with|on)\s+(?:it|this|that|them|my|our|me|us)\b/

/** Words the lexicon cares about — used ONLY to choose how to collapse
 * a stretched word ("neeed", "fundsss") back to its intended form. */
export const STRETCH_TARGETS = new Set(
  'need needed help please money funds fund cash send loan lend urgent urgently emergency pay bills bill rent fee fees transfer wire give spot cover can could would you me now asap donate gift card sending'.split(' ')
)

// ---------------------------------------------------------------
// Second-pass additions (paraphrase coverage found by the corpus)
// ---------------------------------------------------------------

/** "financially", "a small amount", "any sum" — value phrased without
 * naming money. */
export const VALUE_PHRASE_PATTERN =
  /\bfinancially\b|\b(?:small|little|modest|any|some|tiny|the)\s+(?:amount|sum)s?\b(?!\s+of\s+(?:time|effort|work|energy))/

/** "in a bit of a bind financially", "financially strapped". */
export const FINANCIAL_BIND_PATTERN =
  /\b(?:bind|jam|hole|spot|trouble|crisis|hardship|difficulty|mess)\b.{0,15}\bfinancial(?:ly)?\b|\bfinancial(?:ly)?\s+(?:struggling|strapped|tight|stuck|unstable|desperate|drained)\b|\bmoney (?:is |has been |got )?(?:tight|short)\b/

/** "Can I borrow $200 from you?" — the first-person form of the ask. */
export const BORROW_ASK_PATTERN =
  /\b(?:can|could|may|might|would it be (?:ok|okay|alright) if|is it (?:ok|okay|alright) if|would you mind if) i (?:please |maybe |possibly )?(?:borrow|take|have|get)\b/

/** Acquire-type verbs only mean "provide value" with a value-like
 * object ("buy me a gift card"), never with an ordinary purchasable
 * ("buy yourself a $5 coffee"). */
export const ACQUIRE_VERB_PATTERN = /^(?:buy|purchase|get|order|pick up)$/

/** Stray-space evasion ("mone y"): tested against the sentence with all
 * whitespace removed, anchored at the START so it needs an imperative or
 * a modal opener. */
export const SQUASHED_ASK_PATTERN =
  /^(?:please|kindly|just|now|then|simply|can(?:you)?|could(?:you)?|would(?:you)?|willyou)*(?:send|lend|wire|give|transfer|loan|spot|donate)(?:me|us)?(?:the|some|your|a|any)*(?:money|monies|cash|funds|amountx)/
