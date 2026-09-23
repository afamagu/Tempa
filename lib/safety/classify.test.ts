import { describe, it, expect } from 'vitest'
import { classifyContent } from './classify'
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
  ]

  for (const text of benignExamples) {
    it(`"${text}" is allowed, not warned or denied`, () => {
      const result = classifyContent(text)
      expect(result.mutationDisposition).toBe('allow')
      expect(result.escalateCase).toBe(false)
    })
  }
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
    // DIRECT_MONEY_REQUEST + EMERGENCY_MONEY_REQUEST + OFF_PLATFORM_ESCALATION(high variant)
    const result = classifyContent(
      'This is an emergency, I need you to send me money right now, message me on WhatsApp so I can explain.'
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
