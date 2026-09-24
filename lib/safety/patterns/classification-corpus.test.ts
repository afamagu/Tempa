import { describe, it, expect } from 'vitest'
import { classifyContent } from '../classify'
import { FINANCIAL_SOLICITATION_REASON_CODES } from '../reason-codes'
import { DENY, ALLOW } from './corpus'

// The same synthetic corpus the Pattern Library is tested against, run
// through the FULL classifier — so what is proven here is the actual
// enforcement outcome (deny / allow), not just that a sub-detector fired.
// The live-test strings from the production report are permanent members
// of the DENY set (category "live-test").

describe('classifier — DENY corpus is denied as a financial solicitation (no send-anyway path)', () => {
  for (const c of DENY) {
    it(`[${c.category}] ${c.text.slice(0, 90).replace(/\n/g, ' ')}`, () => {
      const result = classifyContent(c.text)
      expect(result.mutationDisposition).toBe('deny')
      expect(result.reasonCodes.some((code) => (FINANCIAL_SOLICITATION_REASON_CODES as readonly string[]).includes(code))).toBe(true)
    })
  }
})

describe('classifier — ALLOW corpus is left alone (talking ABOUT money is fine)', () => {
  for (const c of ALLOW) {
    it(`[${c.category}] ${c.text.slice(0, 90).replace(/\n/g, ' ')}`, () => {
      const result = classifyContent(c.text)
      expect(result.mutationDisposition).toBe('allow')
      expect(result.reasonCodes.some((code) => (FINANCIAL_SOLICITATION_REASON_CODES as readonly string[]).includes(code))).toBe(false)
    })
  }
})

describe('classifier — the exact production live-test strings', () => {
  const LIVE = [
    'I have an urgent need for funds. Please help me.',
    'I have an urgent need for $100. Please help me.',
    'I have an urgent need for money. Please help me.',
    "I told him I needed $100, but he couldn't help. Can you?",
    'I have an urgent need for funds. Please send me money.',
  ]
  it.each(LIVE)('%s -> cannot send', (text) => {
    expect(classifyContent(text).mutationDisposition).toBe('deny')
  })
})

describe('classifier — the policy-mandated close pairs', () => {
  const PAIRS: Array<[string, string]> = [
    ['The shipment is stuck at customs and I only need another $200. Is there any way you could help me?', 'My shipment got stuck at customs and it cost another $200. Business can be exhausting.'],
    ["I'm short until Friday. Could you help me with $50?", "I'm trying to save $50 by Friday."],
    ['My hospital bill is due. Could you help me cover some of it?', 'My hospital bill was enormous, but thankfully it is already paid.'],
    ['Could I use your account to receive the payment?', 'My bank changed my account number yesterday.'],
    ['I can show you where to put $500 into this investment.', "I've been reading about investing lately."],
  ]
  it.each(PAIRS)('DENY %s', (deny) => {
    expect(classifyContent(deny).mutationDisposition).toBe('deny')
  })
  it.each(PAIRS)('ALLOW (paired) %s', (_deny, allow) => {
    expect(classifyContent(allow).mutationDisposition).not.toBe('deny')
  })
})

describe('classifier — a long letter only lets the final ask inherit the IMMEDIATELY preceding context', () => {
  it('an unrelated financial fact far earlier in a long letter does not turn a later bare question into a solicitation', () => {
    const letter = [
      'My rent is $1,500 and I have been budgeting carefully this year.',
      'The weather has been lovely here and I planted tomatoes last week.',
      'The garden is coming along and the neighbours keep dropping by to look at it.',
      'We had a long chat about books and they recommended three that I cannot wait to read.',
      'I finally cleaned out the shed, which took most of the weekend and a lot of patience.',
      '\n\nAnyway, are you free to write again soon? Could you?',
    ].join(' ')
    expect(classifyContent(letter).mutationDisposition).not.toBe('deny')
  })
})

// Unified financial-solicitation enforcement: a STATEMENT of hardship with
// no ask is allowed; an ask directed at the correspondent is denied by
// whichever detector path finds it; nothing financial is ever a warning.
describe('classifier — hardship statements vs. asks (one policy, every detector path)', () => {
  const STATEMENTS = [
    'I need emergency money for surgery.',
    'I need emergency money for hospital treatment.',
    'I need money because I am in hospital.',
    'My rent is due tomorrow.',
    'I cannot afford the shipment fee.',
    'I need to find $200 before Friday.',
  ]
  const ASKS = [
    'I need emergency money for surgery. Could you help me?',
    'My rent is due tomorrow. Can you lend me something?',
    'I cannot afford the shipment fee. Could you cover it?',
    'I need to find $200 before Friday. Can you help?',
    'Please send me money.',
    'Can you transfer $100?',
    'Could you send me emergency money for hospital treatment?',
  ]

  it.each(STATEMENTS)('ALLOW (no ask): %s', (text) => {
    const result = classifyContent(text)
    expect(result.mutationDisposition).toBe('allow')
    expect(result.reasonCodes).toEqual([])
  })

  it.each(ASKS)('DENY (directed ask): %s', (text) => {
    expect(classifyContent(text).mutationDisposition).toBe('deny')
  })

  it('no text carrying a financial-solicitation reason code is ever only a warning', () => {
    const everything = [...DENY.map((c) => c.text), ...ALLOW.map((c) => c.text), ...STATEMENTS, ...ASKS]
    for (const text of everything) {
      const result = classifyContent(text)
      const financial = result.reasonCodes.some((code) => (FINANCIAL_SOLICITATION_REASON_CODES as readonly string[]).includes(code))
      if (financial) expect(result.mutationDisposition, text).toBe('deny')
    }
  })
})
