# Safety Pattern Library

Pure, deterministic, Tempa-owned text patterns behind the Safety classifier.
No I/O, no network, no third-party service: private letters never leave the
process. (`lib/safety/analysis-boundary.ts` is the single entry point and the
place a future, separately reviewed translated representation would attach —
"translation unavailable" can never mean "safe".)

## Financial solicitation (`solicitation.ts`, `lexicon.ts`)

Policy: financial solicitation is **not allowed** on Tempa, whatever the
relationship or the story. Talking *about* money, prices, hardship, scams or
investing is ordinary conversation and stays allowed.

A solicitation is recognised by composition, not by one phrase:

    FINANCIAL NEED / VALUE  +  DIRECTED ASSISTANCE  (+ urgency / payment method / story)

* **Need / value** — money words, amounts (symbols, words, currencies, crypto
  units), gift cards, payment apps and handles, bank/account use, hardship
  frames ("short until Friday", "can't afford", "urgent need for funds").
* **Directed assistance** — an ask addressed to the recipient: modal asks
  ("could you help / lend / send"), polite frames ("any chance you could"),
  imperatives ("please send"), "help me", payment-destination handoffs ("send
  it to my PayPal"), first-person borrowing ("can I borrow").
* **Inheritance** — a bare final ask ("Could you?", "Please help me.") inherits
  financial *need* context only from the previous two sentences of the SAME
  paragraph (≤ 320 characters). An ask with its own non-financial object never
  borrows context.
* **Guards** — reported speech, negation and gratitude only neutralise an ask
  when they come *before* it ("I told him not to send me money"), so
  "Please send me money, don't ask why" is still an ask. Quotations introduced
  by a reporting verb are ignored.
* **Story contexts** (medical, travel, visa/legal, customs, tuition/rent, …) are
  signals layered on an ask, never a violation by themselves.
* **Evasion** — canonical normalisation (homoglyphs, zero-width, leetspeak,
  spaced letters, stretched words, fullwidth digits) plus a squashed-phrase pass
  for stray-space evasion. Amounts are tokenised *before* canonicalisation.
* **Intermediary / money-mule** and **directed investment** asks have their own
  patterns; ordinary investing discussion is allowed.

## Personal contact (`contact.ts`)

A different policy: phone numbers, emails, home addresses and "message me on
WhatsApp" are **not** violations and never a strike. On private letters only,
the sender gets a privacy heads-up (they can still send) and the recipient sees
a short note. Address detection needs both a street-address shape and an
explicit "this is where I live" cue.

## Corpus (`corpus.ts`)

A synthetic, Tempa-written DENY / ALLOW corpus with close pairs (same topic,
opposite sides of the line). `solicitation.test.ts` checks the sub-detector,
`classification-corpus.test.ts` checks the full classifier outcome. The live
production evasions are permanent members. To extend coverage add a case to
`corpus.ts`; if you must change the lexicon, keep the ALLOW corpus green — that
is the guard against over-blocking.
