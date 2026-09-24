import { describe, it, expect } from 'vitest'
import { detectContactSharing } from './contact'

const SHOULD_FIRE = [
  'Message me on WhatsApp.',
  'You can message me on Telegram if you like.',
  'My number is +44 7700 900123.',
  'My phone number is 555-123-4567.',
  'Call me on 0207 946 0958 any evening.',
  'Send me your phone number.',
  'Can I have your email?',
  "What's your WhatsApp?",
  'Email me at someone@example.com.',
  'You can reach me at anna.k@gmail.com',
  'my email is anna dot k at gmail dot com',
  'Add me on Instagram, my handle is @anna_k.',
  "Let's move this conversation to WhatsApp.",
  "Let's continue on Telegram, it is easier.",
  'My address is 42 Baker Street, London.',
  'I live at 12 Willow Lane, near the park.',
  'Please send it to 88 Oak Avenue.',
  'Give me your home address so I can post a gift.',
]

const SHOULD_STAY_SILENT = [
  "I don't really like WhatsApp.",
  'My sister uses Instagram all day and I find it exhausting.',
  'I read that Telegram had an outage yesterday.',
  'I walked down 42 Baker Street yesterday and it was lovely.',
  'Our house number is complicated, the street has no signs.',
  'The order number is 12345678 according to the receipt.',
  'I have 2000 books and 12 shelves.',
  'I emailed my landlord about the boiler.',
  'Signal strength is poor in my village.',
  'Tell me about your day, I love hearing about it.',
  'My phone broke last week and I have been offline a lot.',
  'I text my mother every morning.',
  'I was born in 1987 and moved in 2004 and again in 2011.',
]

describe('Pattern Library — personal contact / off-platform sharing', () => {
  for (const text of SHOULD_FIRE) {
    it(`fires: ${text}`, () => {
      expect(detectContactSharing(text).kinds.length).toBeGreaterThan(0)
    })
  }
  for (const text of SHOULD_STAY_SILENT) {
    it(`silent: ${text}`, () => {
      expect(detectContactSharing(text).kinds).toEqual([])
    })
  }

  it('reports what kind of contact detail it saw', () => {
    expect(detectContactSharing('Email me at someone@example.com').kinds).toContain('email')
    expect(detectContactSharing('My number is +44 7700 900123').kinds).toContain('phone')
    expect(detectContactSharing('Send me your phone number').kinds).toContain('contact_request')
    expect(detectContactSharing('My address is 42 Baker Street').kinds).toContain('address')
  })
})
