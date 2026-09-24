import { describe, it, expect } from 'vitest'
import { extractIndicators } from './indicators'

describe('extractIndicators — structural extraction', () => {
  it('extracts a URL', () => {
    expect(extractIndicators('Check this out: https://example.com/promo').urls).toEqual([
      'https://example.com/promo',
    ])
  })

  it('extracts an email address', () => {
    expect(extractIndicators('Reach me at hello@example.com').emails).toEqual(['hello@example.com'])
  })

  it('extracts a plausible phone number and ignores short digit runs', () => {
    const result = extractIndicators('Call me on +1 555-123-4567, or extension 42')
    expect(result.phoneNumbers).toEqual(['+1 555-123-4567'])
  })

  it('extracts a currency-symbol amount', () => {
    const result = extractIndicators('Can you send me $300?')
    expect(result.moneyAmounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: 300, currencyHint: '$' })])
    )
  })

  it('extracts a word-form currency amount', () => {
    const result = extractIndicators('I need 50000 naira please')
    expect(result.moneyAmounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: 50000 })])
    )
  })

  it('extracts an obfuscated spaced-out amount', () => {
    const result = extractIndicators('send $ 3 0 0 now')
    expect(result.moneyAmounts.some((a) => a.value === 300)).toBe(true)
  })

  it('extracts an ETH-style crypto address', () => {
    const address = '0x' + 'a'.repeat(40)
    expect(extractIndicators(`send to ${address}`).cryptoAddresses).toEqual([address])
  })

  it('does not extract a crypto address from ordinary hex-free text', () => {
    expect(extractIndicators('The weather was 0 degrees today.').cryptoAddresses).toEqual([])
  })
})

describe('extractIndicators — keyword/phrase indicators', () => {
  it('detects a directed money request ("can you send")', () => {
    expect(extractIndicators('Can you send me $300?').hasDirectedMoneyRequest).toBe(true)
  })

  it('does not flag a bare currency mention as a directed request', () => {
    expect(extractIndicators('I bought this for $200.').hasDirectedMoneyRequest).toBe(false)
  })

  it('detects a loan/bill request phrase', () => {
    expect(extractIndicators('Please help pay my rent this month.').hasLoanOrBillRequestPhrase).toBe(true)
  })

  it('does not flag a bare rent statement as a loan/bill request', () => {
    expect(extractIndicators('My rent increased this month.').hasLoanOrBillRequestPhrase).toBe(false)
  })

  it('detects a crypto keyword', () => {
    expect(extractIndicators('Bitcoin fell again.').hasCryptoKeyword).toBe(true)
  })

  it('detects a gift-card keyword', () => {
    expect(extractIndicators('I bought my brother a gift card.').hasGiftCardKeyword).toBe(true)
  })

  it('detects the narrow gift-card-code-request pattern only for the specific scam shape', () => {
    expect(
      extractIndicators('Buy a Steam gift card and send me the code.').hasGiftCardCodeRequest
    ).toBe(true)
    expect(extractIndicators('I bought my brother a gift card.').hasGiftCardCodeRequest).toBe(false)
  })

  it('separates investment PROMISE language from neutral investment TOPIC mentions', () => {
    expect(extractIndicators('I can double your investment.').hasInvestmentPromiseLanguage).toBe(true)
    expect(extractIndicators('I lost money investing in crypto.').hasInvestmentPromiseLanguage).toBe(false)
    expect(extractIndicators('I lost money investing in crypto.').hasInvestmentTopicKeyword).toBe(true)
  })

  it('detects an off-platform escalation phrase', () => {
    expect(extractIndicators("Let's move to Telegram.").hasOffPlatformKeyword).toBe(true)
  })

  it('detects emergency language', () => {
    expect(extractIndicators('I need emergency money for hospital treatment.').hasEmergencyKeyword).toBe(true)
  })

  it('does not flag a past-tense complaint as emergency solicitation input alone', () => {
    const result = extractIndicators('My hospital bill was shocking.')
    expect(result.hasEmergencyKeyword).toBe(true) // topic present
    expect(result.hasDirectedMoneyRequest).toBe(false) // but no request
  })

  it('detects bank details being shared unprompted', () => {
    expect(extractIndicators('Here is my bank account: 12345.').hasBankDetailsSharedPhrase).toBe(true)
  })

  it('detects a link shortener', () => {
    expect(extractIndicators('Click here: bit.ly/abc123').hasSuspiciousLinkShortener).toBe(true)
  })

  it('detects a cashtag-shaped payment handle even though canonicalization folds "$" to "s"', () => {
    // toCanonicalText's leet-speak pass rewrites '$' -> 's' for keyword
    // matching, which would destroy a cashtag if tested against
    // canonical text — the cashtag pattern must run on display text.
    expect(extractIndicators('You can pay me at $johndoe123').hasPaymentHandleKeyword).toBe(true)
  })

  it('does not flag a bare IBAN mention as a shared payment detail', () => {
    expect(extractIndicators('What exactly is an IBAN?').hasBankDetailsSharedPhrase).toBe(false)
    expect(extractIndicators('My bank asked me for my IBAN yesterday.').hasBankDetailsSharedPhrase).toBe(false)
  })

  it('detects an actual IBAN disclosure as a shared payment detail', () => {
    expect(extractIndicators('Here is my IBAN: DE89370400440532013000').hasBankDetailsSharedPhrase).toBe(true)
  })

  it('does not flag a directed verb with no financial context as a money request', () => {
    expect(extractIndicators('Can you send me a photo?').hasDirectedMoneyRequest).toBe(false)
    expect(extractIndicators('Could you give me your opinion?').hasDirectedMoneyRequest).toBe(false)
  })

  it('does not treat a bare topic word co-occurring with an off-platform mention as a pitch, regardless of punctuation', () => {
    // A comma, not a period, joins these clauses — punctuation must
    // not be what decides risk here (see hasInvestmentPitchContext's
    // doc comment).
    expect(
      extractIndicators("I lost money investing in crypto last year, let's chat on WhatsApp sometime.")
        .hasInvestmentPitchContext
    ).toBe(false)
    expect(
      extractIndicators("I lost money investing in crypto last year. Let's chat on WhatsApp sometime.")
        .hasInvestmentPitchContext
    ).toBe(false)
  })

  it('detects explicit pitch/proposition language', () => {
    expect(extractIndicators("Let's move to Telegram, I have a forex opportunity for you.").hasInvestmentPitchContext).toBe(
      true
    )
    expect(extractIndicators("Let's go to Telegram so I can show you the investment.").hasInvestmentPitchContext).toBe(
      true
    )
  })

  it('detects a directed crypto transfer to an actual address, distinct from a bare address mention', () => {
    const address = '0x' + 'a'.repeat(40)
    expect(extractIndicators(`Send USDT to ${address}`).hasDirectedMoneyRequest).toBe(true)
    expect(extractIndicators(`My Ethereum wallet address is ${address}`).hasDirectedMoneyRequest).toBe(false)
  })
})

describe('extractIndicators — locally-bound composites (do not combine unrelated sentences)', () => {
  it('binds a crypto term to the request only when they are in the same sentence', () => {
    const address = '0x' + 'e'.repeat(40)
    const unrelated = extractIndicators(`Can you send me $100? This article uses ${address} as an example.`)
    expect(unrelated.hasDirectedCryptoRequest).toBe(false)
    expect(unrelated.hasDirectedCryptoTransfer).toBe(false)

    const related = extractIndicators(`Send USDT to ${address}`)
    expect(related.hasDirectedCryptoRequest).toBe(true)
    expect(related.hasDirectedCryptoTransfer).toBe(true)
  })

  it('binds an amount to the request only when they are in the same sentence', () => {
    expect(extractIndicators('Could you send me some money? My camera cost $300.').hasDirectedMoneyRequestWithAmount).toBe(
      false
    )
    expect(extractIndicators('Can you send me $300?').hasDirectedMoneyRequestWithAmount).toBe(true)
  })

  it('binds emergency vocabulary to the request only when they are in the same sentence', () => {
    expect(
      extractIndicators('Could you send me some money? My brother works at a hospital.').hasEmergencyFramedMoneyRequest
    ).toBe(false)
    expect(extractIndicators('Could you send me emergency money for hospital treatment?').hasEmergencyFramedMoneyRequest).toBe(true)
  })

  it('binds a URL to the request only when they are in the same sentence', () => {
    expect(
      extractIndicators('Could you send me some money? Here is an article I liked: https://example.com')
        .hasSolicitationLinkedUrl
    ).toBe(false)
    expect(extractIndicators('Can you send me $300 here: https://example.com/pay').hasSolicitationLinkedUrl).toBe(true)
  })

  it('does not treat a bare link shortener as suspicious context on its own', () => {
    expect(extractIndicators('Here is the recipe: https://bit.ly/example').hasSuspiciousShortenerWithContext).toBe(false)
    expect(
      extractIndicators('Can you send me $300 at my payment page: https://bit.ly/pay').hasSuspiciousShortenerWithContext
    ).toBe(true)
  })

  it('binds a crypto address to the actual transfer target, not just anywhere in the sentence', () => {
    const address = '0x' + 'f'.repeat(40)
    expect(
      extractIndicators(`This article uses ${address} as an example; can you send the photo to me?`).hasDirectedCryptoTransfer
    ).toBe(false)
    expect(extractIndicators(`Send USDT to ${address}`).hasDirectedCryptoTransfer).toBe(true)
  })

  it('binds emergency framing to the request within the same CLAUSE, not just the same sentence', () => {
    expect(
      extractIndicators('Could you send me some money, my brother works at a hospital.').hasEmergencyFramedMoneyRequest
    ).toBe(false)
    expect(extractIndicators('Could you send me money for my hospital bill?').hasEmergencyFramedMoneyRequest).toBe(true)
    expect(extractIndicators('Could you send me emergency money for surgery?').hasEmergencyFramedMoneyRequest).toBe(true)
  })

  it('binds off-platform escalation to the solicitation within the same CLAUSE, not just the same sentence', () => {
    expect(
      extractIndicators("Could you send me some money, and let's chat on WhatsApp later about the football match.")
        .hasOffPlatformSolicitation
    ).toBe(false)
    expect(
      extractIndicators("Send me the money and message me on WhatsApp once you've done it.").hasOffPlatformSolicitation
    ).toBe(true)
    expect(
      extractIndicators("Let's move to Telegram so I can show you the investment opportunity.").hasOffPlatformSolicitation
    ).toBe(true)
  })

  it('binds shortener context within the same CLAUSE, not just the same sentence', () => {
    expect(
      extractIndicators('I was reading about Bitcoin; here is the recipe: https://bit.ly/example')
        .hasSuspiciousShortenerWithContext
    ).toBe(false)
  })

  it('treats a qualifying "and" as a clause boundary, but not a genuine continuation', () => {
    expect(
      extractIndicators('Could you send me some money and my brother works at a hospital.').hasEmergencyFramedMoneyRequest
    ).toBe(false)
    expect(
      extractIndicators("Could you send me some money and let's chat on WhatsApp later about football.")
        .hasOffPlatformSolicitation
    ).toBe(false)
    expect(extractIndicators('Please send me money because I am in hospital.').hasEmergencyFramedMoneyRequest).toBe(true)
    expect(
      extractIndicators("Send me the money and message me on WhatsApp once you've done it.").hasOffPlatformSolicitation
    ).toBe(true)
  })

  it('binds TRANSFER_TO_ACCOUNT subtype evidence to the matched phrase, not the whole sentence', () => {
    const withGiftCard = extractIndicators('Send the money to my account, I bought my brother a gift card yesterday.')
    expect(withGiftCard.hasDirectedMoneyRequest).toBe(true)
    expect(withGiftCard.hasDirectedGiftCardRequest).toBe(false)

    const withCrypto = extractIndicators('Send the money to my account, I was reading about Bitcoin earlier.')
    expect(withCrypto.hasDirectedMoneyRequest).toBe(true)
    expect(withCrypto.hasDirectedCryptoRequest).toBe(false)
  })

  it('binds the gift-card-code scam shape to a single sentence', () => {
    expect(
      extractIndicators('I bought a Steam gift card. Please send me the code for the front gate.').hasGiftCardCodeRequest
    ).toBe(false)
    expect(extractIndicators('Buy a Steam gift card and send me the code.').hasGiftCardCodeRequest).toBe(true)
  })

  it('does not treat a bare crypto/payment-service topic word as suspicious shortener context', () => {
    expect(
      extractIndicators('I use PayPal and here is the recipe: https://bit.ly/example').hasSuspiciousShortenerWithContext
    ).toBe(false)
    expect(
      extractIndicators('I was reading about Bitcoin and here is the recipe: https://bit.ly/example')
        .hasSuspiciousShortenerWithContext
    ).toBe(false)
  })
})
