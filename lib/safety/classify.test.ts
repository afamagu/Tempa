import { describe, it, expect } from 'vitest'
import { classifyContent, combineClassifications } from './classify'
import type { RiskBand } from './reason-codes'

// ============================================================
// §21 — benign corpus. None of these may ever warn or deny.
// ============================================================
describe('false-positive corpus — ordinary conversation about money must never warn/deny', () => {
  const benignExamples = [
    'Food is expensive here.',
    'I work in banking.',
    'My rent increased.',
    'Bitcoin fell again.',
    'I bought this for $200.',
    'My hospital bill was ridiculous.',
    'Petrol costs a fortune here.',
    'I work for a bank.',
    'My rent increased this month.',
    'I lost money investing in crypto.',
    'The hotel cost me $200.',
    'My daughter works in finance.',
    'The hospital bill was shocking.',
    'I bought my brother a gift card.',
    'My hospital bill was $500.',
    'The surgery cost us $2,000.',
    'After the accident the repair bill was £800.',
    'An IBAN is an international bank account identifier.',
    'IBAN is used for international transfers.',
    'My Ethereum wallet address is 0x' + 'a'.repeat(40),
    'This article uses 0x' + 'b'.repeat(40) + ' as an example Ethereum address.',
  ]

  for (const text of benignExamples) {
    it(`"${text}" is allowed, not warned or denied, with no safety reason code`, () => {
      const result = classifyContent(text)
      expect(result.mutationDisposition).toBe('allow')
      expect(result.escalateCase).toBe(false)
      // Ordinary descriptive financial vocabulary — an amount, a
      // crypto/gift-card/bank word, a hospital word — with no request
      // or other suspicious structure attached must produce NO signal
      // at all, not merely one that happens not to warn. 'weak' is
      // reserved for actual (if minor) safety-relevant STRUCTURE, like
      // a bare off-platform mention or a bare link — never for a
      // financial noun on its own.
      expect(result.riskBand).toBe('none')
      expect(result.reasonCodes).toEqual([])
    })
  }

  // Ordinary correspondence verbs that happen to overlap with the
  // transfer-verb vocabulary ("send", "give", "lend", "pay", "share")
  // must never, on their own, read as a money request — only an actual
  // nearby financial/value term does that (see classify.ts's
  // DIRECT_MONEY_REQUEST rule and indicators.ts's
  // sentenceHasFinancialContext).
  const benignDirectedRequests = [
    'Can you send me a photo?',
    'Please send me the recipe.',
    'Could you give me your opinion?',
    'Can you lend me that book?',
    'Can you share the photos from your trip?',
    "Could you give me a hand with this?",
    "Can you pay attention to what I'm about to say?",
  ]

  for (const text of benignDirectedRequests) {
    it(`"${text}" is an ordinary request, not a money request`, () => {
      const result = classifyContent(text)
      expect(result.riskBand).toBe('none')
      expect(result.mutationDisposition).toBe('allow')
      expect(result.reasonCodes).not.toContain('DIRECT_MONEY_REQUEST')
    })
  }

  it('an amount discussed elsewhere in the letter does not retroactively turn an unrelated request into a money request', () => {
    // The "$300" belongs to a completely separate sentence about the
    // camera, not to the photo request — financial context must be
    // tied to the actual request, not merely present anywhere in the
    // same message body.
    const result = classifyContent('Can you send me the photo? The camera cost me $300.')
    expect(result.riskBand).toBe('none')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.reasonCodes).not.toContain('DIRECT_MONEY_REQUEST')
  })
})

// ============================================================
// Item 1 — a directed transfer-shaped verb ("send"/"give"/"lend"/
// "pay") is never, by itself, a money request. It only becomes
// DIRECT_MONEY_REQUEST when a financial/value term (an amount, money/
// funds/cash/payment, a payment handle, a crypto asset, gift-card
// mechanics, or a bill/loan/rent/fees phrase) appears in the same
// sentence.
// ============================================================
describe('directed money request requires nearby financial context, not just a transfer verb', () => {
  it('preserves detection of an explicit amount request', () => {
    const result = classifyContent('Can you send me $300?')
    expect(result.reasonCodes).toContain('DIRECT_MONEY_REQUEST')
    expect(result.mutationDisposition).not.toBe('allow')
  })

  it('preserves detection of a "money" word request with no amount', () => {
    const result = classifyContent('Could you send me some money?')
    expect(result.reasonCodes).toContain('DIRECT_MONEY_REQUEST')
    expect(result.mutationDisposition).not.toBe('allow')
  })

  it('preserves detection of an explicit transfer-to-account request', () => {
    const result = classifyContent('Please transfer $500 to my account.')
    expect(result.reasonCodes).toContain('DIRECT_MONEY_REQUEST')
    expect(result.mutationDisposition).not.toBe('allow')
  })

  it('preserves detection of a "funds" word request', () => {
    const result = classifyContent('I need you to send me funds.')
    expect(result.reasonCodes).toContain('DIRECT_MONEY_REQUEST')
    expect(result.mutationDisposition).not.toBe('allow')
  })

  // Locality regression: an unrelated amount describing a DIFFERENT
  // noun ("the camera") elsewhere in the SAME sentence must not be
  // read as the object of "send me the photo".
  it('does not treat an amount describing an unrelated object in the same sentence as the request object', () => {
    const result = classifyContent('Can you send me the photo of the camera I bought for $300?')
    expect(result.riskBand).toBe('none')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.reasonCodes).not.toContain('DIRECT_MONEY_REQUEST')
  })
})

// ============================================================
// Emergency vocabulary requires an actual request, not just an amount.
// "My hospital bill was $500." is a descriptive statement; only a
// directed money request or a genuine bill/loan-help ask makes it
// EMERGENCY_MONEY_REQUEST.
// ============================================================
describe('emergency vocabulary requires an actual solicitation, not just an incidental amount', () => {
  it('describing what an emergency cost is not a request', () => {
    for (const text of [
      'My hospital bill was $500.',
      'The surgery cost us $2,000.',
      'After the accident the repair bill was £800.',
    ]) {
      const result = classifyContent(text)
      expect(result.reasonCodes).not.toContain('EMERGENCY_MONEY_REQUEST')
      expect(result.mutationDisposition).toBe('allow')
    }
  })

  it('preserves detection of an actual emergency money request', () => {
    const result = classifyContent('I need emergency money for hospital treatment.')
    expect(result.reasonCodes).toContain('EMERGENCY_MONEY_REQUEST')
  })

  it('preserves detection of an emergency-framed bill-help request', () => {
    const result = classifyContent('Please help me pay the hospital bill.')
    expect(result.reasonCodes).toContain('EMERGENCY_MONEY_REQUEST')
  })
})

// ============================================================
// Emergency/hospital vocabulary must not make an ordinary link
// suspicious — only a directed money request (or a suspicious
// shortener, or an explicit phishing phrase) does that.
// ============================================================
describe('emergency vocabulary does not make a link suspicious', () => {
  it('a hospital/clinic link with no request stays allowed with no meaningful link signal', () => {
    for (const text of [
      'This is the hospital website: https://example.com',
      'Here is the clinic page I mentioned: https://example.com/clinic',
    ]) {
      const result = classifyContent(text)
      expect(result.mutationDisposition).toBe('allow')
      expect(result.escalateCase).toBe(false)
    }
  })
})

// ============================================================
// A crypto address is not automatically a solicitation — only an
// actual transfer/payment request involving the address is.
// ============================================================
describe('a crypto address requires transfer/solicitation context, not just co-occurrence with a crypto keyword', () => {
  it('stating one\'s own wallet address is not a solicitation', () => {
    const address = '0x' + 'a'.repeat(40)
    const result = classifyContent(`My Ethereum wallet address is ${address}`)
    expect(result.riskBand).not.toBe('severe')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.reasonCodes).not.toContain('CRYPTO_SOLICITATION')
  })

  it('an address used as a documentation example is not a solicitation', () => {
    const address = '0x' + 'b'.repeat(40)
    const result = classifyContent(`This article uses ${address} as an example Ethereum address.`)
    expect(result.mutationDisposition).toBe('allow')
    expect(result.reasonCodes).not.toContain('CRYPTO_SOLICITATION')
  })

  it('preserves severe/deny for an actual crypto transfer solicitation', () => {
    const address = '0x' + 'c'.repeat(40)
    const result = classifyContent(`Send USDT to ${address}`)
    expect(result.riskBand).toBe('severe')
    expect(result.mutationDisposition).toBe('deny')
    expect(result.reasonCodes).toContain('CRYPTO_SOLICITATION')
  })
})

// ============================================================
// Investment/off-platform correlation requires explicit pitch/
// proposition language, not mere co-occurrence — and must not depend
// on punctuation (a comma vs. a period must not change the outcome).
// ============================================================
describe('investment/off-platform escalation requires explicit pitch language, not punctuation-dependent co-occurrence', () => {
  it('an unrelated crypto aside and an unrelated off-platform aside stay low-risk regardless of whether they are joined by a comma or a period', () => {
    for (const text of [
      "I lost money investing in crypto last year, let's chat on WhatsApp sometime.",
      "I lost money investing in crypto last year. Let's chat on WhatsApp sometime.",
    ]) {
      const result = classifyContent(text)
      expect(result.riskBand).not.toBe('high')
      expect(result.riskBand).not.toBe('severe')
      expect(result.mutationDisposition).toBe('allow')
      expect(result.escalateCase).toBe(false)
      expect(result.reasonCodes).not.toContain('INVESTMENT_SOLICITATION')
    }
  })

  it('preserves the escalation shape for explicit pitch language', () => {
    const codes = classifyContent("Let's move to Telegram, I have a forex opportunity for you.").reasonCodes
    expect(codes).toContain('OFF_PLATFORM_ESCALATION')
    expect(codes).toContain('INVESTMENT_SOLICITATION')
  })

  it('preserves detection when an off-platform move is paired with an investment promise', () => {
    const result = classifyContent("Message me on WhatsApp and I'll show you how to double your investment.")
    expect(result.reasonCodes).toContain('INVESTMENT_SOLICITATION')
    expect(result.mutationDisposition).not.toBe('allow')
  })

  it('preserves the original worked example', () => {
    const codes = classifyContent("Let's go to Telegram so I can show you the investment.").reasonCodes
    expect(codes).toContain('OFF_PLATFORM_ESCALATION')
    expect(codes).toContain('INVESTMENT_SOLICITATION')
  })
})

// ============================================================
// Item 2 (IBAN) — a bare mention of "IBAN" or an explanatory
// definition is a topic mention, not a disclosure. Only an actual
// shared account/IBAN detail counts as
// PAYMENT_DETAILS.
// ============================================================
describe('bank-detail sharing requires an actual disclosure, not a bare mention', () => {
  it('a question about what an IBAN is stays allowed with no PAYMENT_DETAILS code', () => {
    const result = classifyContent('What exactly is an IBAN?')
    expect(result.riskBand).toBe('none')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.reasonCodes).not.toContain('PAYMENT_DETAILS')
  })

  it('recounting that a bank asked for an IBAN stays allowed with no PAYMENT_DETAILS code', () => {
    const result = classifyContent('My bank asked me for my IBAN yesterday.')
    expect(result.riskBand).toBe('none')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.reasonCodes).not.toContain('PAYMENT_DETAILS')
  })

  it('an explanatory definition of what an IBAN is stays allowed with no PAYMENT_DETAILS code', () => {
    for (const text of [
      'An IBAN is an international bank account identifier.',
      'IBAN is used for international transfers.',
    ]) {
      const result = classifyContent(text)
      expect(result.riskBand).toBe('none')
      expect(result.mutationDisposition).toBe('allow')
      expect(result.reasonCodes).not.toContain('PAYMENT_DETAILS')
    }
  })

  it('actually sharing an IBAN triggers PAYMENT_DETAILS', () => {
    for (const text of ['My IBAN is DE89370400440532013000', 'Here is my IBAN: DE89370400440532013000', 'IBAN: DE89370400440532013000']) {
      expect(classifyContent(text).reasonCodes).toContain('PAYMENT_DETAILS')
    }
  })
})

// ============================================================
// Item 3 — a neutral investment/crypto/gift-card topic and an off-
// platform mention only correlate when they occur in the SAME
// sentence, not merely somewhere in the same message.
// ============================================================
describe('investment/off-platform correlation requires local proximity, not just co-occurrence', () => {
  it('an unrelated crypto aside and an unrelated off-platform aside in the same message stay low-risk', () => {
    const result = classifyContent('I lost money investing in crypto last year. Let\'s chat on WhatsApp sometime.')
    expect(result.riskBand).not.toBe('high')
    expect(result.riskBand).not.toBe('severe')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.escalateCase).toBe(false)
    expect(result.reasonCodes).not.toContain('INVESTMENT_SOLICITATION')
  })

  it('preserves the escalation shape when the pitch and the platform are in the same sentence', () => {
    const codes = classifyContent("Let's move to Telegram, I have a forex opportunity for you.").reasonCodes
    expect(codes).toContain('OFF_PLATFORM_ESCALATION')
    expect(codes).toContain('INVESTMENT_SOLICITATION')
  })

  it('preserves detection of an explicit investment promise regardless of proximity wording', () => {
    const result = classifyContent('Invest with me and I will double your money.')
    expect(result.reasonCodes).toContain('INVESTMENT_SOLICITATION')
    expect(result.mutationDisposition).not.toBe('allow')
  })
})

// ============================================================
// Item 4 — a cashtag-shaped payment handle ("$name") must be detected
// from display text, not the leet-folded canonical text (which turns
// '$' into 's').
// ============================================================
describe('cashtag/payment-handle detection survives canonicalization', () => {
  it('detects a directed request to a cashtag as PAYMENT_DETAILS', () => {
    const result = classifyContent('You can pay me at $johndoe123')
    expect(result.reasonCodes).toContain('PAYMENT_DETAILS')
    expect(result.mutationDisposition).not.toBe('allow')
  })
})

// ============================================================
// Item 5 — risk_band, mutation_disposition, and escalate_case are
// genuinely independent axes, not one value under three names.
// ============================================================
describe('risk, enforcement, and case escalation are independent axes', () => {
  it('an unprompted bank-details disclosure is classified high-risk and escalated, but not auto-blocked', () => {
    const result = classifyContent('Here is my IBAN: DE89370400440532013000')
    expect(result.riskBand).toBe('high')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.escalateCase).toBe(true)
  })

  it('a meaningful-risk bill request warns without escalating a case', () => {
    // Deliberately has no transfer-verb match (no send/pay/transfer/
    // wire/lend/give), so only LOAN_OR_BILL_REQUEST fires — a single
    // meaningful signal, not a compounded pair (contrast "Please pay
    // my electricity bill.", which also matches the "please...pay"
    // transfer verb and compounds to 'high').
    const result = classifyContent('Could you help me with my electricity bill this month?')
    expect(result.riskBand).toBe('meaningful')
    expect(result.mutationDisposition).toBe('warn')
    expect(result.escalateCase).toBe(false)
  })

  it('a severe-risk gift-card-code scam denies and escalates', () => {
    const result = classifyContent('Buy a Steam gift card and send me the code.')
    expect(result.riskBand).toBe('severe')
    expect(result.mutationDisposition).toBe('deny')
    expect(result.escalateCase).toBe(true)
  })
})

// ============================================================
// §21 — clear violations. All of these must warn or deny.
// ============================================================
describe('violation corpus — clear financial solicitation must warn or deny', () => {
  const violations: { text: string; expectDeny?: boolean }[] = [
    { text: 'Can you send me $300?' },
    { text: 'Please pay my electricity bill.' },
    { text: 'Buy a Steam gift card and send me the code.', expectDeny: true },
    { text: 'Send USDT to this wallet.' },
    { text: 'I can double your investment.' },
    { text: 'Transfer the money to this account.' },
    { text: 'I need emergency money for hospital treatment.' },
    { text: "Let's go to Telegram so I can show you the investment." },
  ]

  for (const { text, expectDeny } of violations) {
    it(`"${text}" is not silently allowed`, () => {
      const result = classifyContent(text)
      expect(result.mutationDisposition).not.toBe('allow')
      if (expectDeny) {
        expect(result.mutationDisposition).toBe('deny')
      }
    })
  }
})

// ============================================================
// Obfuscation — the same violations, disguised, must still fire.
// ============================================================
describe('obfuscation/adversarial corpus', () => {
  it('detects a leet-speak money request', () => {
    const result = classifyContent('can u s3nd m3 $300 pl3as3')
    expect(result.mutationDisposition).not.toBe('allow')
  })

  it('detects a homoglyph-obfuscated money request (Cyrillic lookalikes)', () => {
    // "sеnd mе mоnеy" with Cyrillic е/о substituted for Latin e/o
    const result = classifyContent('can you sеnd mе mоnеy')
    expect(result.mutationDisposition).not.toBe('allow')
  })

  it('detects a letter-spaced-out gift card scam', () => {
    const result = classifyContent('b.u.y a st.e.a.m gift card and s.e.n.d m.e the c.o.d.e')
    expect(result.reasonCodes).toContain('GIFT_CARD_REQUEST')
  })

  it('detects a spaced-out currency amount request', () => {
    const result = classifyContent('please send me $ 3 0 0 today')
    expect(result.mutationDisposition).not.toBe('allow')
  })

  it('detects an obfuscated crypto wallet solicitation', () => {
    const address = '0x' + 'b'.repeat(40)
    const result = classifyContent(`s3nd usdt to ${address}`)
    expect(result.mutationDisposition).toBe('deny')
  })

  it('detects a zero-width-character-broken word', () => {
    const result = classifyContent('can you s​end m​e $500')
    expect(result.mutationDisposition).not.toBe('allow')
  })

  it('a bare non-English-script sentence with no request stays allowed (homoglyph folding must not manufacture false positives)', () => {
    // Ordinary Russian-adjacent text using some of the same code
    // points that happen to be in the homoglyph table, but forming no
    // request pattern once folded.
    const result = classifyContent('The cafе was clоse today.')
    expect(result.mutationDisposition).toBe('allow')
  })
})

// ============================================================
// Ambiguous cases — must not be treated as confident violations,
// but also aren't necessarily fully silent.
// ============================================================
describe('ambiguous cases — do not over-punish', () => {
  it('a bare off-platform mention alone stays allowed (only escalates combined with a financial signal)', () => {
    const result = classifyContent("Let's talk on WhatsApp sometime.")
    expect(result.mutationDisposition).toBe('allow')
    expect(result.escalateCase).toBe(false)
  })

  it('a bare link with no financial context stays allowed', () => {
    const result = classifyContent('Here is an article I liked: https://example.com/article')
    expect(result.mutationDisposition).toBe('allow')
  })

  it('a quoted greeting reused verbatim is not, by itself, financial solicitation', () => {
    const result = classifyContent('Dear friend, I hope this letter finds you well.')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.riskBand).toBe('none')
  })

  it('discussing a shared bill without asking the recipient for money stays allowed', () => {
    const result = classifyContent('The electricity bill here has gotten so expensive lately.')
    expect(result.mutationDisposition).toBe('allow')
  })
})

// ============================================================
// Reason-code correctness — spot-check the taxonomy fires the RIGHT
// code, not just "some" code.
// ============================================================
describe('reason codes fire precisely', () => {
  it('DIRECT_MONEY_REQUEST for a plain ask', () => {
    expect(classifyContent('Can you send me $300?').reasonCodes).toContain('DIRECT_MONEY_REQUEST')
  })

  it('LOAN_OR_BILL_REQUEST for a bill-payment ask', () => {
    expect(classifyContent('Please pay my electricity bill.').reasonCodes).toContain('LOAN_OR_BILL_REQUEST')
  })

  it('GIFT_CARD_REQUEST for the gift-card-code scam shape', () => {
    expect(classifyContent('Buy a Steam gift card and send me the code.').reasonCodes).toContain(
      'GIFT_CARD_REQUEST'
    )
  })

  it('CRYPTO_SOLICITATION for a wallet-transfer request', () => {
    expect(classifyContent('Send USDT to this wallet.').reasonCodes).toContain('CRYPTO_SOLICITATION')
  })

  it('INVESTMENT_SOLICITATION for a doubling promise', () => {
    expect(classifyContent('I can double your investment.').reasonCodes).toContain('INVESTMENT_SOLICITATION')
  })

  it('EMERGENCY_MONEY_REQUEST for an emergency-framed ask', () => {
    expect(classifyContent('I need emergency money for hospital treatment.').reasonCodes).toContain(
      'EMERGENCY_MONEY_REQUEST'
    )
  })

  it('OFF_PLATFORM_ESCALATION + INVESTMENT_SOLICITATION for the Telegram/investment combo', () => {
    const codes = classifyContent("Let's go to Telegram so I can show you the investment.").reasonCodes
    expect(codes).toContain('OFF_PLATFORM_ESCALATION')
    expect(codes).toContain('INVESTMENT_SOLICITATION')
  })

  it('never fires a code that was not in the taxonomy', () => {
    const result = classifyContent('Can you send me $300 via bit.ly/pay right now?')
    for (const code of result.reasonCodes) {
      expect(typeof code).toBe('string')
    }
  })
})

// ============================================================
// Compounding — multiple concerning traits together read as worse
// than any one alone.
// ============================================================
describe('compounding', () => {
  it('a message combining a direct request, urgency, and off-platform escalation is at least as severe as any single trait alone', () => {
    const single = classifyContent('Can you send me $300?')
    const compound = classifyContent(
      'Can you send me $300 right away? Please, this is an emergency, message me on WhatsApp.'
    )
    const order: RiskBand[] = ['none', 'weak', 'meaningful', 'high', 'severe']
    expect(order.indexOf(compound.riskBand)).toBeGreaterThanOrEqual(order.indexOf(single.riskBand))
  })

  it('exactly two independent meaningful-or-above codes bump the band to at least high', () => {
    // DIRECT_MONEY_REQUEST (meaningful, no amount) + LOAN_OR_BILL_REQUEST (meaningful)
    const result = classifyContent('Can you please help pay my rent? I need you to send it today.')
    expect(result.reasonCodes.length).toBeGreaterThanOrEqual(2)
    expect(['high', 'severe']).toContain(result.riskBand)
  })

  it('three or more independent meaningful-or-above codes together escalate to severe', () => {
    // DIRECT_MONEY_REQUEST(high, amount) + EMERGENCY_MONEY_REQUEST(high)
    // + OFF_PLATFORM_ESCALATION(high) — deliberately keeps the
    // emergency framing and the off-platform mention in the SAME
    // clause as the request (no comma anywhere), so this exercises
    // compounding without depending on cross-clause binding, which is
    // no longer how these composites work (see the locality-focused
    // describe blocks below).
    const result = classifyContent(
      'This is an emergency and I need you to send me $500 right now and please message me on WhatsApp immediately.'
    )
    expect(result.reasonCodes.length).toBeGreaterThanOrEqual(3)
    expect(result.riskBand).toBe('severe')
    expect(result.mutationDisposition).toBe('deny')
  })

  it('does not inflate the compounding count with codes that only ever fired a WEAK-band rule', () => {
    // One genuinely meaningful signal (LOAN_OR_BILL_REQUEST) plus two
    // purely incidental weak-only mentions (a bare off-platform
    // reference with no financial correlation, and a bare link with no
    // shortener/urgency correlation). Three distinct reason codes fire,
    // but only ONE of them ever reached 'meaningful' — this must not
    // be treated the same as three independently meaningful signals,
    // or an ordinary "let's chat on WhatsApp, here's an article" aside
    // would wrongly deny a legitimate tuition-help ask.
    const result = classifyContent(
      "Can you help me cover my tuition fees? Let's catch up on WhatsApp sometime, here's an article: https://example.com/read"
    )
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['LOAN_OR_BILL_REQUEST', 'OFF_PLATFORM_ESCALATION', 'SUSPICIOUS_LINK'])
    )
    expect(result.riskBand).toBe('meaningful')
    expect(result.mutationDisposition).toBe('warn')
  })
})

// ============================================================
// Additional benign edge cases (spec §21/§22 breadth)
// ============================================================
describe('additional benign edge cases', () => {
  it('a non-English currency symbol used descriptively stays allowed', () => {
    const result = classifyContent('The taxi here costs ₦2000, which is a lot.')
    expect(result.mutationDisposition).toBe('allow')
  })

  it('recommending a bank/financial topic without a request stays allowed', () => {
    const result = classifyContent('Do you have a good bank you would recommend for savings?')
    expect(result.mutationDisposition).toBe('allow')
  })

  it('a genuine, short, commonly-reused greeting is never treated as suspicious content by the classifier itself', () => {
    // Near-duplicate-outreach detection is a behavioral (Checkpoint 5)
    // concern across MANY letters, not something a single message's
    // content classifier should ever penalize on its own.
    const result = classifyContent('Hi! Lovely to hear from you. How has your week been?')
    expect(result.riskBand).toBe('none')
  })

  it('discussing a past crypto investment loss in detail stays allowed even with multiple crypto mentions', () => {
    const result = classifyContent(
      'I lost a lot of money investing in Bitcoin and Ethereum last year. Crypto is so volatile.'
    )
    expect(result.mutationDisposition).toBe('allow')
  })
})

// ============================================================
// Structural invariants
// ============================================================
describe('structural invariants', () => {
  it('escalateCase is only ever true for high/severe risk', () => {
    const cases: string[] = [
      'Food is expensive here.',
      'Can you send me $300?',
      'Buy a Steam gift card and send me the code.',
    ]
    for (const text of cases) {
      const result = classifyContent(text)
      if (result.escalateCase) {
        expect(['high', 'severe']).toContain(result.riskBand)
      }
    }
  })

  it('mutationDisposition "deny" only ever occurs at "severe" risk', () => {
    const texts = [
      'Food is expensive here.',
      'Can you send me $300?',
      'Buy a Steam gift card and send me the code.',
      'Send USDT to this wallet.',
    ]
    for (const text of texts) {
      const result = classifyContent(text)
      if (result.mutationDisposition === 'deny') {
        expect(result.riskBand).toBe('severe')
      }
    }
  })

  it('empty content is always allowed with no risk', () => {
    const result = classifyContent('')
    expect(result.riskBand).toBe('none')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.reasonCodes).toEqual([])
  })
})

// ============================================================
// Locality architecture — classify.ts's rules must never manufacture
// a relationship between two facts merely because both exist
// somewhere in the same (possibly long) letter. General principle:
// whenever two facts combine to raise severity, the same two facts in
// UNRELATED sentences of the same letter must not.
// ============================================================
describe('locality — unrelated facts elsewhere in the letter must not combine', () => {
  it('a money request in one sentence and an unrelated crypto documentation example in another is a money request, not crypto solicitation, and not severe/deny', () => {
    const result = classifyContent('Can you send me $100? This article uses 0x' + 'd'.repeat(40) + ' as an example Ethereum address.')
    expect(result.reasonCodes).toContain('DIRECT_MONEY_REQUEST')
    expect(result.reasonCodes).not.toContain('CRYPTO_SOLICITATION')
    expect(result.riskBand).not.toBe('severe')
    expect(result.mutationDisposition).not.toBe('deny')
  })

  it('a money request and an unrelated mention that a relative works at a hospital is not EMERGENCY_MONEY_REQUEST', () => {
    const result = classifyContent('Could you send me some money? My brother works at a hospital.')
    expect(result.reasonCodes).not.toContain('EMERGENCY_MONEY_REQUEST')
  })

  it('a money request and an unrelated article link does not turn the link into a meaningful SUSPICIOUS_LINK', () => {
    const withLink = classifyContent('Could you send me some money? Here is an article I liked: https://example.com')
    const withoutLink = classifyContent('Could you send me some money?')
    expect(withLink.reasonCodes).toContain('SUSPICIOUS_LINK')
    expect(withLink.reasonCodes.filter((c) => c === 'SUSPICIOUS_LINK')).toHaveLength(1)
    // The bare link only ever reaches SUSPICIOUS_LINK's 'weak' tier, so
    // adding it must not change the band/disposition the money request
    // alone already produces — the link is not itself "meaningful".
    expect(withLink.riskBand).toBe(withoutLink.riskBand)
    expect(withLink.mutationDisposition).toBe(withoutLink.mutationDisposition)
  })

  it('a money request and an unrelated amount describing something else does not upgrade the request to "high"', () => {
    const result = classifyContent('Could you send me some money? My camera cost $300.')
    expect(result.reasonCodes).toContain('DIRECT_MONEY_REQUEST')
    expect(result.riskBand).toBe('meaningful')
  })

  it('a money request and an unrelated gift-card purchase mention is not GIFT_CARD_REQUEST', () => {
    const result = classifyContent('Can you send me some money? I bought my brother a gift card yesterday.')
    expect(result.reasonCodes).not.toContain('GIFT_CARD_REQUEST')
  })

  it('a money request and an unrelated off-platform aside stays at "weak" off-platform evidence, not "high"', () => {
    const result = classifyContent('Can you send me some money? Also, let\'s catch up on WhatsApp sometime about something else.')
    expect(result.reasonCodes).toContain('OFF_PLATFORM_ESCALATION')
    expect(result.escalateCase).toBe(false)
  })

  it('a phishing phrase and an unrelated link in a different sentence is not PHISHING_SIGNAL', () => {
    const result = classifyContent(
      'Please verify your account details with your bank directly. Here is a photo from my trip: https://example.com/photo.jpg'
    )
    expect(result.reasonCodes).not.toContain('PHISHING_SIGNAL')
  })

  it('a money request and an unrelated PayPal mention is not PAYMENT_DETAILS', () => {
    const result = classifyContent('Can you send me some money? I use PayPal for other things sometimes.')
    expect(result.reasonCodes).not.toContain('PAYMENT_DETAILS')
  })
})

// ============================================================
// Item 1 — INVESTMENT_PROMISE_PATTERN must require an explicit
// financial object, and must not fire from discussion/criticism of
// the scam phrase itself.
// ============================================================
describe('investment promise language requires an explicit financial object, not just "double"', () => {
  it('ordinary uses of "double" stay allowed', () => {
    for (const text of ['I can double the recipe.', 'I could double the batch.', 'I will double-check that tomorrow.']) {
      const result = classifyContent(text)
      expect(result.riskBand).toBe('none')
      expect(result.mutationDisposition).toBe('allow')
      expect(result.reasonCodes).not.toContain('INVESTMENT_SOLICITATION')
    }
  })

  it('discussing/warning about the scam phrase is not itself a solicitation', () => {
    const result = classifyContent('Anyone promising to double your money is probably scamming you.')
    expect(result.reasonCodes).not.toContain('INVESTMENT_SOLICITATION')
    expect(result.mutationDisposition).toBe('allow')
  })

  it('preserves detection of an actual promise', () => {
    for (const text of ['I can double your money.', 'I will double your investment.']) {
      expect(classifyContent(text).reasonCodes).toContain('INVESTMENT_SOLICITATION')
    }
  })
})

// ============================================================
// Item 2 — "transfer" is not inherently financial enough for
// sentence-wide correlation; it needs the same local object binding as
// send/give/lend/pay/buy, unless the nearby object is genuinely
// money/funds/amount/account/wallet.
// ============================================================
describe('"transfer" requires a locally-tied financial object, like the other ordinary-sense verbs', () => {
  it('transferring a file described elsewhere by price stays allowed', () => {
    const result = classifyContent('Can you transfer me the file I bought for $300?')
    expect(result.riskBand).toBe('none')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.reasonCodes).not.toContain('DIRECT_MONEY_REQUEST')
  })

  it('transferring photos to a laptop stays allowed', () => {
    const result = classifyContent('Could you transfer the photos to my laptop?')
    expect(result.riskBand).toBe('none')
    expect(result.mutationDisposition).toBe('allow')
  })

  it('preserves detection of transferring money to an account', () => {
    const result = classifyContent('Please transfer $500 to my account.')
    expect(result.reasonCodes).toContain('DIRECT_MONEY_REQUEST')
    expect(result.mutationDisposition).not.toBe('allow')
  })
})

// ============================================================
// Item 3 — a URL shortener alone is only weak structural evidence; it
// must combine with genuinely suspicious local context to warn.
// ============================================================
describe('a link shortener alone does not warn', () => {
  it('a shortened recipe link stays allowed with no meaningful link signal', () => {
    const result = classifyContent('Here is the recipe: https://bit.ly/example')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.escalateCase).toBe(false)
  })

  it('preserves a shortener combined, in the same sentence, with a directed money request', () => {
    const result = classifyContent('Can you send me $300 at my payment page: https://bit.ly/pay')
    expect(result.mutationDisposition).not.toBe('allow')
    expect(result.reasonCodes).toContain('SUSPICIOUS_LINK')
  })
})

// ============================================================
// Residual locality fixes — same-SENTENCE co-occurrence was still too
// broad for four composites: a crypto address anywhere in a sentence
// containing a "verb...to" phrase, and three composites (emergency,
// off-platform, shortener) that didn't account for a single sentence
// joining multiple unrelated CLAUSES with a comma or semicolon.
// ============================================================
describe('crypto address must be bound to the actual transfer target, not just present in the sentence', () => {
  it('stays benign when the address and the transfer phrase are unrelated parts of the same sentence', () => {
    const address = '0x' + 'f'.repeat(40)
    const result = classifyContent(`This article uses ${address} as an example; can you send the photo to me?`)
    expect(result.reasonCodes).not.toContain('CRYPTO_SOLICITATION')
    expect(result.riskBand).not.toBe('severe')
    expect(result.mutationDisposition).not.toBe('deny')
  })

  it('preserves severe/deny when the address is the actual transfer target', () => {
    const address = '0x' + '1'.repeat(40)
    const result = classifyContent(`Send USDT to ${address}`)
    expect(result.reasonCodes).toContain('CRYPTO_SOLICITATION')
    expect(result.riskBand).toBe('severe')
    expect(result.mutationDisposition).toBe('deny')
  })
})

describe('emergency framing must be bound to the request within the same clause, regardless of comma vs. period', () => {
  it('an unrelated third-party aside in the same sentence, comma-joined, is not EMERGENCY_MONEY_REQUEST', () => {
    const result = classifyContent('Could you send me some money, my brother works at a hospital.')
    expect(result.reasonCodes).not.toContain('EMERGENCY_MONEY_REQUEST')
  })

  it('preserves detection when the emergency vocabulary is actually part of the request', () => {
    expect(classifyContent('Could you send me money for my hospital bill?').reasonCodes).toContain(
      'EMERGENCY_MONEY_REQUEST'
    )
    expect(classifyContent('I need emergency money for surgery.').reasonCodes).toContain('EMERGENCY_MONEY_REQUEST')
  })
})

describe('off-platform escalation must be bound to the solicitation within the same clause', () => {
  it('an unrelated off-platform aside in the same sentence, comma-joined, does not escalate', () => {
    const result = classifyContent(
      "Could you send me some money, and let's chat on WhatsApp later about the football match."
    )
    expect(result.reasonCodes).toContain('OFF_PLATFORM_ESCALATION')
    expect(result.escalateCase).toBe(false)
    expect(result.riskBand).not.toBe('high')
  })

  it('preserves detection when the off-platform move is actually part of the solicitation', () => {
    const codes1 = classifyContent("Send me the money and message me on WhatsApp once you've done it.").reasonCodes
    expect(codes1).toContain('OFF_PLATFORM_ESCALATION')

    const codes2 = classifyContent("Let's move to Telegram so I can show you the investment opportunity.").reasonCodes
    expect(codes2).toContain('OFF_PLATFORM_ESCALATION')
    expect(codes2).toContain('INVESTMENT_SOLICITATION')
  })
})

describe('a shortener needs genuinely suspicious context in the same clause, not just the same sentence', () => {
  it('an unrelated crypto aside sharing a sentence with a shortened link stays weak', () => {
    const result = classifyContent('I was reading about Bitcoin; here is the recipe: https://bit.ly/example')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.escalateCase).toBe(false)
  })

  it('preserves a shortener actually tied to a payment/solicitation instruction', () => {
    const result = classifyContent('Can you send me $300 at my payment page: https://bit.ly/pay')
    expect(result.mutationDisposition).not.toBe('allow')
  })
})

// ============================================================
// Final residual locality fixes:
// 1. Clause boundaries must not depend only on punctuation — a
//    coordinating "and" joining two independent statements is also a
//    boundary, but a genuine continuation of the same request is not.
// 2. TRANSFER_TO_ACCOUNT_PATTERN's subtype evidence (crypto/gift-card/
//    amount) must bind to the matched transfer phrase, not the whole
//    sentence.
// 3. The gift-card-code scam shape must not bridge unrelated sentences.
// 4. A shortener needs an actual solicitation shape nearby, not just a
//    bare crypto/payment-service topic word.
// ============================================================
describe('"and" is a clause boundary only when it introduces a genuinely independent statement', () => {
  it('an unrelated third-party aside joined by "and" is not EMERGENCY_MONEY_REQUEST', () => {
    const result = classifyContent('Could you send me some money and my brother works at a hospital.')
    expect(result.reasonCodes).not.toContain('EMERGENCY_MONEY_REQUEST')
  })

  it('an unrelated off-platform topic-shift joined by "and" does not escalate', () => {
    const result = classifyContent("Could you send me some money and let's chat on WhatsApp later about football.")
    expect(result.reasonCodes).toContain('OFF_PLATFORM_ESCALATION')
    expect(result.escalateCase).toBe(false)
    expect(result.riskBand).not.toBe('high')
  })

  it('preserves a subordinate "because" clause staying bound to the request', () => {
    const result = classifyContent('I need money because I am in hospital.')
    expect(result.reasonCodes).toContain('EMERGENCY_MONEY_REQUEST')
  })

  it('preserves a second instruction genuinely continuing the same request, joined by "and"', () => {
    const result = classifyContent("Send me the money and message me on WhatsApp once you've done it.")
    expect(result.reasonCodes).toContain('OFF_PLATFORM_ESCALATION')
  })
})

describe('TRANSFER_TO_ACCOUNT subtype evidence binds to the matched phrase, not the whole sentence', () => {
  it('does not attach GIFT_CARD_REQUEST from an unrelated clause', () => {
    const result = classifyContent('Send the money to my account, I bought my brother a gift card yesterday.')
    expect(result.reasonCodes).toContain('DIRECT_MONEY_REQUEST')
    expect(result.reasonCodes).not.toContain('GIFT_CARD_REQUEST')
  })

  it('does not attach CRYPTO_SOLICITATION from an unrelated clause', () => {
    const result = classifyContent('Send the money to my account, I was reading about Bitcoin earlier.')
    expect(result.reasonCodes).toContain('DIRECT_MONEY_REQUEST')
    expect(result.reasonCodes).not.toContain('CRYPTO_SOLICITATION')
  })
})

describe('the gift-card-code scam shape must not bridge unrelated sentences', () => {
  it('stays benign when the purchase and the code request are unrelated sentences', () => {
    const result = classifyContent('I bought a Steam gift card. Please send me the code for the front gate.')
    expect(result.reasonCodes).not.toContain('GIFT_CARD_REQUEST')
  })

  it('preserves detection of the actual scam shape in one sentence', () => {
    const result = classifyContent('Buy a Steam gift card and send me the code.')
    expect(result.reasonCodes).toContain('GIFT_CARD_REQUEST')
    expect(result.mutationDisposition).toBe('deny')
  })
})

describe('a shortener does not upgrade from a bare crypto/payment-service topic sharing the clause', () => {
  it('stays allowed next to a bare PayPal mention', () => {
    const result = classifyContent('I use PayPal and here is the recipe: https://bit.ly/example')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.escalateCase).toBe(false)
  })

  it('stays allowed next to a bare Bitcoin mention', () => {
    const result = classifyContent('I was reading about Bitcoin and here is the recipe: https://bit.ly/example')
    expect(result.mutationDisposition).toBe('allow')
    expect(result.escalateCase).toBe(false)
  })
})

// ============================================================
// combineClassifications — Checkpoint 3's Postcard-text bypass fix.
// Classifies a Letter body separately from its optional Postcard
// fields, then combines the STRUCTURED results — never concatenates
// the raw texts first (see the function's own doc comment for why).
// ============================================================
describe('combineClassifications — structured combination, never invented cross-field proximity', () => {
  it('a complete solicitation entirely contained in one field alone produces its own full classification, unaffected by what other fields say', () => {
    const body = classifyContent('The weather has been lovely here.')
    const backMessage = classifyContent('Buy a Steam gift card and send me the code.')
    const combined = combineClassifications([body, backMessage])
    expect(combined.riskBand).toBe('severe')
    expect(combined.mutationDisposition).toBe('deny')
    expect(combined.reasonCodes).toContain('GIFT_CARD_REQUEST')
  })

  it('two genuinely unrelated half-sentences in different fields never combine into a fabricated match', () => {
    // Neither half is a directed request on its own — money is merely
    // mentioned in one field, off-platform is merely mentioned in the
    // other, with no directed request tying either to the recipient.
    const body = classifyContent('Rent here is expensive.')
    const backMessage = classifyContent("Let's talk more sometime.")
    const combined = combineClassifications([body, backMessage])
    expect(combined.mutationDisposition).toBe('allow')
    expect(combined.escalateCase).toBe(false)
  })

  it('takes the max risk band across fields, not the body\'s alone', () => {
    const body = classifyContent('Hello there, how are you?')
    const backMessage = classifyContent('Buy a Steam gift card and send me the code.')
    expect(body.riskBand).toBe('none')
    expect(backMessage.riskBand).toBe('severe')
    const combined = combineClassifications([body, backMessage])
    expect(combined.riskBand).toBe('severe')
  })

  it('unions reason codes across fields rather than keeping only one field\'s own', () => {
    const body = classifyContent('Can you send me $300?')
    const backMessage = classifyContent('Buy a Steam gift card and send me the code.')
    const combined = combineClassifications([body, backMessage])
    expect(combined.reasonCodes).toContain('DIRECT_MONEY_REQUEST')
    expect(combined.reasonCodes).toContain('GIFT_CARD_REQUEST')
  })

  it('takes the most restrictive disposition and OR\'s escalateCase across fields', () => {
    const allowField = classifyContent('Hello, just saying hi.')
    const denyField = classifyContent('Buy a Steam gift card and send me the code.')
    const combined = combineClassifications([allowField, denyField])
    expect(combined.mutationDisposition).toBe('deny')
  })

  it('a single-element list behaves identically to that field\'s own classification', () => {
    const only = classifyContent('Can you send me $300?')
    const combined = combineClassifications([only])
    expect(combined).toEqual(only)
  })

  it('an empty list combines to the neutral none/allow/no-escalate result', () => {
    const combined = combineClassifications([])
    expect(combined).toEqual({ riskBand: 'none', reasonCodes: [], mutationDisposition: 'allow', escalateCase: false })
  })
})
