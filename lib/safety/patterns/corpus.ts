// Tempa-owned SYNTHETIC adversarial corpus for the financial-solicitation
// Pattern Library. Every string here was written by us; nothing is copied
// from any third-party scam dataset. Category taxonomy follows the
// public consumer-protection guidance of the FTC / FBI IC3 / eSafety
// (romance scams, advance-fee, emergency, gift-card, crypto, money-mule),
// expressed as our own sentences.
//
// DENY  = the text asks the recipient to provide / move value.
// ALLOW = the text talks ABOUT money, hardship, scams or investing
//         without directing a request for value at the recipient.
//
// Pairs marked `pair` are deliberate close pairs: same topic, different
// side of the line. They are how we check the detector is compositional
// rather than fixture-shaped.

export type CorpusCase = { text: string; category: string; pair?: string }

export const DENY: CorpusCase[] = [
  // --- live-test evasions (permanent) ---
  { category: 'live-test', text: 'I have an urgent need for funds. Please help me.' },
  { category: 'live-test', text: 'I have an urgent need for $100. Please help me.' },
  { category: 'live-test', text: 'I have an urgent need for money. Please help me.' },
  { category: 'live-test', text: 'I told him I needed $100, but he couldn\'t help. Can you?' },
  { category: 'live-test', text: 'I have an urgent need for funds. Please send me money.' },
  { category: 'live-test', text: 'Please send me money. I love you.' },

  // --- direct requests ---
  { category: 'direct', text: 'Can you send me $200?' },
  { category: 'direct', text: 'Could you lend me some money until Friday?' },
  { category: 'direct', text: 'Would you be able to wire me 500 dollars?' },
  { category: 'direct', text: 'Please transfer $50 to my account.' },
  { category: 'direct', text: 'Can you spot me $20?' },
  { category: 'direct', text: 'Send me money please.' },
  { category: 'direct', text: 'Could you send me some cash?' },
  { category: 'direct', text: 'Can you help me with $300?' },
  { category: 'direct', text: 'Please give me 100 euros.' },
  { category: 'direct', text: 'Could you loan me a thousand dollars?' },
  { category: 'direct', text: 'I need you to send me two hundred dollars.' },
  { category: 'direct', text: 'Would you mind sending me £75?' },

  // --- need paraphrases + directed assistance ---
  { category: 'need-paraphrase', text: 'I am in urgent need of financial help. Could you assist me?' },
  { category: 'need-paraphrase', text: 'I am short on money right now. Can you help?' },
  { category: 'need-paraphrase', text: 'I am in a financial emergency. Please help me.' },
  { category: 'need-paraphrase', text: "I'm broke this month. Could you help me out?" },
  { category: 'need-paraphrase', text: 'I really need some funds urgently. Would you help me?' },
  { category: 'need-paraphrase', text: "I'm short until Friday. Could you help me with $50?", pair: 'save-50' },
  { category: 'need-paraphrase', text: 'I do not have enough money to cover this. Could you help?' },
  { category: 'need-paraphrase', text: 'I cannot afford the fee. Can you help me pay it?' },
  { category: 'need-paraphrase', text: 'I am desperate for cash. Please help me.' },

  // --- cross-sentence reference ---
  { category: 'cross-sentence', text: 'I still need $200 for the shipment. My brother couldn\'t help. Could you?' },
  { category: 'cross-sentence', text: 'I need funds for my rent. Can you help me?' },
  { category: 'cross-sentence', text: 'I asked my bank for a loan and they said no. Could you help instead?' },
  { category: 'cross-sentence', text: 'My landlord wants the rent by Monday and I am short. Please help me.' },
  { category: 'cross-sentence', text: 'I lost my wallet and have no money. Can you help me?' },

  // --- narrative scam contexts (with an ask) ---
  { category: 'medical', text: 'My hospital bill is due. Could you help me cover some of it?', pair: 'hospital-paid' },
  { category: 'medical', text: 'My mother needs surgery and we are short. Can you send something to help?' },
  { category: 'travel', text: 'I am stranded at the airport and my card was declined. Could you send me money for a ticket?' },
  { category: 'visa', text: 'The visa fee is $350 and I cannot pay it. Would you cover it for me?' },
  { category: 'legal', text: 'I need a lawyer and cannot afford one. Could you help me with the legal fees?' },
  { category: 'customs', text: 'The shipment is stuck at customs and I only need another $200. Is there any way you could help me?', pair: 'customs-cost' },
  { category: 'customs', text: 'The package is held at customs. Please pay the release fee for me.' },
  { category: 'tuition', text: 'My tuition is due Friday. Could you help me pay it?' },
  { category: 'debt', text: 'I owe money to some people and they are threatening me. Please help me pay them.' },
  { category: 'inheritance', text: 'I am about to receive an inheritance but need to pay the transfer fee first. Could you cover the fee and I will repay you double?' },
  { category: 'business', text: 'My business is failing and I need capital. Could you invest $1000 in it?' },
  { category: 'emergency', text: 'It is an emergency, my son is in the hospital. Please send money.' },
  { category: 'bills', text: 'I cannot pay my electricity bill this month. Can you help me cover it?' },

  // --- payment methods / handles ---
  { category: 'payment-app', text: 'You can send it to my PayPal, it is quick.' },
  { category: 'payment-app', text: 'Send $30 to my cashapp $tempaperson please.' },
  { category: 'payment-app', text: 'Please Venmo me $25.' },
  { category: 'payment-app', text: 'Could you send the money to my Zelle?' },
  { category: 'gift-card', text: 'Can you buy me an iTunes gift card and send me the code?' },
  { category: 'gift-card', text: 'Please get a Google Play card and send me the PIN.' },
  { category: 'crypto', text: 'Could you send me some bitcoin? I will give you my wallet address.' },
  { category: 'crypto', text: 'Please transfer 0.05 BTC to my wallet.' },
  { category: 'bank', text: 'Can you deposit $400 into my bank account?' },
  { category: 'bank', text: 'Please wire the money to my bank, I will send the details.' },
  { category: 'donation', text: 'Would you donate $100 to help me and my family?' },

  // --- money mule / intermediary ---
  { category: 'mule', text: 'Could I use your account to receive the payment?', pair: 'bank-changed' },
  { category: 'mule', text: 'Can you receive this money for me and forward it to my friend?' },
  { category: 'mule', text: 'Please let me use your bank account for a transfer.' },
  { category: 'mule', text: 'I need you to cash a cheque on my behalf.' },
  { category: 'mule', text: 'Can you forward the funds to my agent after you receive them?' },
  { category: 'mule', text: 'Please hold this money for me and send it on.' },

  // --- investment solicitation ---
  { category: 'investment', text: 'I can show you where to put $500 into this investment.', pair: 'reading-investing' },
  { category: 'investment', text: 'You should invest in this crypto platform with me, I will show you how to deposit.' },
  { category: 'investment', text: 'Send $1000 to my trading account and I will double it for you.' },
  { category: 'investment', text: 'Let me help you invest. Just deposit $200 with my broker.' },

  // --- evasion / normalization ---
  { category: 'evasion', text: 'Can you s.e.n.d me m0ney?' },
  { category: 'evasion', text: 'Please send me $$$ urgently!!!' },
  { category: 'evasion', text: 'can   you   send   me   $ 1 0 0' },
  { category: 'evasion', text: 'CAN YOU SEND ME MONEY PLEASE' },
  { category: 'evasion', text: 'Pls send me mon3y' },
  { category: 'evasion', text: 'Could u lend me 200 usd' },
  { category: 'evasion', text: 'I neeed fundsss urgentlyyy. Pleaseee help me.' },
  { category: 'evasion', text: 'Please help me with $ 200' },

  // --- multi-paragraph: request inherits only the nearby context ---
  {
    category: 'long-letter',
    text: 'The weather has been lovely here and I planted tomatoes last week. The garden is coming along.\n\nI have been having a hard time though. I need $400 for the deposit on a flat. Could you help me?\n\nAnyway, tell me about your week.',
  },
  // --- guard-bypass attempts: reporting/negation words AFTER the ask ---
  { category: 'guard-bypass', text: 'Please send me money, my brother told me to ask you.' },
  { category: 'guard-bypass', text: "Please don't hesitate to send me money." },
  { category: 'guard-bypass', text: "Please send me money, don't ask why." },
  { category: 'guard-bypass', text: 'Could you lend me $100? Someone said you were kind.' },
  { category: 'guard-bypass', text: 'Can you send me money? I would never ask if it were not an emergency.' },
  // --- homoglyph / invisible-character evasion ---
  { category: 'evasion', text: 'Please sеnd mе mоnеy.' },
  { category: 'evasion', text: 'Can you se​nd me mon​ey?' },
  { category: 'evasion', text: 'Could you lend me ＄５００?' },

  // --- second batch: paraphrase / construction variety ---
  { category: "paraphrase", text: "I am in a bit of a bind financially. Any chance you could help me out?" },
  { category: "paraphrase", text: "Things are tight and I have run out of money. I was hoping you could lend me a little." },
  { category: "paraphrase", text: "I would be so grateful if you could send me some funds." },
  { category: "paraphrase", text: "Is there any way you can wire me $150 today?" },
  { category: "paraphrase", text: "Any chance you could cover my rent this month?" },
  { category: "paraphrase", text: "Could you please assist me financially?" },
  { category: "paraphrase", text: "I need financial support urgently. Please assist me." },
  { category: "paraphrase", text: "Will you help me with some money for the airport taxi?" },
  { category: "paraphrase", text: "Can you front me $40 until payday?" },
  { category: "paraphrase", text: "Please send some cash, I have nothing left." },
  { category: "paraphrase", text: "I need you to pay the fee for me." },
  { category: "paraphrase", text: "Would you send a small amount to help me get through the month? Even $20 helps." },
  { category: "paraphrase", text: "I am begging you, please help me with money." },
  { category: "paraphrase", text: "I have run out of cash. Could you transfer something to me?" },
  { category: "cross-sentence", text: "I am stuck at the border and my cards do not work. I need $250 for the fee. Please, can you help?" },
  { category: "cross-sentence", text: "My rent is overdue and the landlord is angry. Could you spare something?" },
  { category: "cross-sentence", text: "My daughter needs medication and I am short this week. Would you be willing to help us?" },
  { category: "cross-sentence", text: "I need to pay the customs charge. Could you pay it for me and I will repay you?" },
  { category: "customs", text: "The parcel I am sending you is held at customs. Please pay the clearance fee." },
  { category: "gift-card", text: "Buy a $100 Steam card and send me the numbers on the back." },
  { category: "gift-card", text: "Can you get an Amazon gift card for me? I will explain later." },
  { category: "crypto", text: "Send me USDT to my wallet address and I will pay you back." },
  { category: "crypto", text: "Could you buy some bitcoin and send it to me?" },
  { category: "bank", text: "Could you send the payment through my bank details?" },
  { category: "loan", text: "Could you give me a loan? I will pay it back with interest." },
  { category: "loan", text: "Can I borrow $200 from you?" },
  { category: "loan", text: "Would you lend me money for one week?" },
  { category: "investment", text: "You should put $300 into my forex account, the returns are guaranteed." },
  { category: "investment", text: "I can show you how to invest $100 and turn it into $1000 with my platform." },
  { category: "mule", text: "Can I use your bank account to receive a payment? I will give you a commission." },
  { category: "mule", text: "Will you receive money on my behalf and pass it on to my cousin?" },
  { category: "mule", text: "Could you cash this cheque for me and send me the money?" },
  { category: "evasion", text: "Please lend me m.o.n.e.y" },
  { category: "evasion", text: "can y0u s3nd me 5OO dollars" },
  { category: "evasion", text: "Could you PLEASE send me  FUNDS?" },
  { category: "evasion", text: "Send me the mone y now" },
]

export const ALLOW: CorpusCase[] = [
  // --- required examples from the policy ---
  { category: 'policy', text: 'My rent is $1,500.' },
  { category: 'policy', text: 'I spent $100 on groceries.' },
  { category: 'policy', text: 'Business has been slow this month.' },
  { category: 'policy', text: 'My shipment cost another $200 to clear.' },
  { category: 'policy', text: 'Someone asked me for money and I said no.' },
  { category: 'policy', text: 'I told him not to send me money.' },
  { category: 'policy', text: 'Scammers sometimes ask people to buy gift cards.' },
  { category: 'policy', text: 'I need to save another $100 before Friday.' },

  // --- close pairs ---
  { category: 'pair', text: 'My shipment got stuck at customs and it cost another $200. Business can be exhausting.', pair: 'customs-cost' },
  { category: 'pair', text: "I'm trying to save $50 by Friday.", pair: 'save-50' },
  { category: 'pair', text: 'My hospital bill was enormous, but thankfully it is already paid.', pair: 'hospital-paid' },
  { category: 'pair', text: 'My bank changed my account number yesterday.', pair: 'bank-changed' },
  { category: 'pair', text: "I've been reading about investing lately.", pair: 'reading-investing' },

  // --- ordinary finance / economics / business / prices ---
  { category: 'finance', text: 'Inflation has made groceries so expensive here.' },
  { category: 'finance', text: 'I think the central bank will raise interest rates again.' },
  { category: 'finance', text: 'Rent in my city has doubled in five years.' },
  { category: 'finance', text: 'I have been budgeting carefully and saving about $200 a month.' },
  { category: 'finance', text: 'The exchange rate is terrible for travellers this year.' },
  { category: 'finance', text: 'How much does a coffee cost where you live? Here it is about $4.' },
  { category: 'finance', text: 'I work in accounting, so I spend my days thinking about invoices.' },
  { category: 'finance', text: 'I paid off my student loan last year and it felt wonderful.' },
  { category: 'finance', text: 'My tuition was expensive but worth it.' },
  { category: 'finance', text: 'I used to run a small business selling ceramics.' },
  { category: 'finance', text: 'Do you think crypto is a bubble? I never understood it.' },
  { category: 'finance', text: 'I read that bitcoin fell again today.' },
  { category: 'finance', text: 'My bank account was hacked once, so now I use two-factor everywhere.' },
  { category: 'finance', text: 'Could you recommend a good book about economics?' },
  { category: 'finance', text: 'Can you tell me how people budget where you live?' },
  { category: 'finance', text: 'What do you think about paying people fairly for care work?' },
  { category: 'finance', text: 'I donated $50 to the animal shelter last weekend.' },
  { category: 'finance', text: 'I sent money to my sister for her birthday.' },

  // --- hardship / story with NO ask ---
  { category: 'story', text: 'It has been a hard month. My car broke down and the repair was expensive.' },
  { category: 'story', text: 'I was short on money as a student, so I learned to cook cheaply.' },
  { category: 'story', text: 'When I was stranded at the airport once, a kind stranger let me charge my phone.' },
  { category: 'story', text: 'My mother had surgery last year and the bills were huge, but she is fine now.' },
  { category: 'story', text: 'I have been stressed because the visa process is slow and the fees keep rising.' },
  { category: 'story', text: 'I lost my wallet last week, what a headache. I had to cancel every card.' },

  // --- scam awareness / reported speech / negation ---
  { category: 'awareness', text: 'Someone online asked me to send money for a plane ticket. I blocked them.' },
  { category: 'awareness', text: 'Be careful, people may ask you to send money. Never do it.' },
  { category: 'awareness', text: 'She said, "Can you send me money?" and I knew it was a scam.' },
  { category: 'awareness', text: 'I would never ask you to send me money.' },
  { category: 'awareness', text: 'Please do not send me money, I do not want any.' },
  { category: 'awareness', text: 'Romance scammers often say they need funds urgently.' },
  { category: 'awareness', text: 'My aunt was tricked into buying gift cards and sending the codes.' },

  // --- non-financial help / requests ---
  { category: 'help', text: 'Could you help me choose a gift for my sister?' },
  { category: 'help', text: 'Can you help me with my English? I want to sound more natural.' },
  { category: 'help', text: 'Could you send me a photo of your garden? I would love to see it.' },
  { category: 'help', text: 'Can you send me a recipe for that stew you mentioned?' },
  { category: 'help', text: 'Please help me understand what a haiku is.' },
  { category: 'help', text: 'Thank you so much, you really helped me last week.' },
  { category: 'help', text: 'Could you help me figure out how to write a good ending to my story?' },
  { category: 'help', text: 'I need help deciding which city to visit. Can you help?' },
  { category: 'help', text: 'I bought a camera for $300. Could you send me some tips on photography?' },
  { category: 'help', text: 'I need a break from work. Can you tell me about your weekend?' },

  // --- saving / earning / self-directed need ---
  { category: 'self', text: 'I need to save some money for a trip to Portugal.' },
  { category: 'self', text: 'I need to earn more before the summer, so I am picking up extra shifts.' },
  { category: 'self', text: 'I need funds for the pottery class but I will get them from my bonus.' },
  { category: 'self', text: 'I need cash for the market tomorrow, so I am stopping by the ATM.' },

  // --- investing conversation ---
  { category: 'investing', text: 'I have been reading about index funds and how compound interest works.' },
  { category: 'investing', text: 'My father taught me to invest slowly and stay patient.' },
  { category: 'investing', text: 'What do you think about investing in property?' },
  { category: 'investing', text: 'I lost money on a bad investment years ago and it taught me a lot.' },

  // --- general benign letter content ---
  { category: 'benign', text: 'The market was full of flowers today and I bought a small bunch for $5.' },
  { category: 'benign', text: 'I went for a long walk by the river and thought about our last letter.' },
  { category: 'benign', text: 'Tell me about your day. I always love hearing how you spend your evenings.' },
  { category: 'benign', text: 'I hope you are well. Can you tell me more about your job?' },
  { category: 'benign', text: 'Would you like to swap book recommendations?' },
  { category: 'benign', text: 'Can you help me? I am trying to remember the name of that poet you love.' },
  // --- second batch ---
  { category: "finance2", text: "I read that rent prices doubled. Can you believe that?" },
  { category: "finance2", text: "Could you tell me how much groceries cost where you live?" },
  { category: "finance2", text: "Can you recommend a budgeting app?" },
  { category: "finance2", text: "Do you think it is wise to invest in gold?" },
  { category: "finance2", text: "Would you invest in a small business, if you had savings?" },
  { category: "finance2", text: "I have been paying my bills on time for years, which makes me proud." },
  { category: "finance2", text: "The funds for our local library were cut this year, which is sad." },
  { category: "finance2", text: "Our town raised funds for the flood victims last spring." },
  { category: "finance2", text: "I am learning how mortgages work because we want to buy a flat one day." },
  { category: "finance2", text: "I need to pay my electricity bill tomorrow, so I will go to the bank in the morning." },
  { category: "finance2", text: "I am short on time this week but I will write more soon." },
  { category: "finance2", text: "I am broke in the best way: I spent everything on a trip to the coast." },
  { category: "finance2", text: "Money has never really interested me; I like simple things." },
  { category: "finance2", text: "Could you please send me a link to that article about the economy?" },
  { category: "finance2", text: "Can you send me the address of that bakery? I would love to visit." },
  { category: "finance2", text: "Can you help me understand how credit scores work?" },
  { category: "finance2", text: "Could you help me plan a budget trip to Lisbon?" },
  { category: "finance2", text: "Could you help me with the recipe? I want to make it for under $10." },
  { category: "story2", text: "My friend needed money for a deposit, so I helped her last year." },
  { category: "story2", text: "I lent my brother some money once and learned to be careful about that." },
  { category: "story2", text: "My landlord asked me for the rent early, which was annoying." },
  { category: "story2", text: "A stranger at the station asked me for money and I walked on." },
  { category: "story2", text: "They asked me to send money, and I refused, and then I reported them." },
  { category: "story2", text: "I would love to help you if you ever need advice about moving abroad." },
  { category: "story2", text: "If you ever need anything, like a recommendation for a good book, just ask me." },
  { category: "story2", text: "I would not lend money to anyone I have not met, and I hope you understand." },
  { category: "story2", text: "Never send money to someone you only know online. That is my one rule." },
  { category: "story2", text: "Please never send me money; I would feel terrible." },
  { category: "story2", text: "I wonder if you could tell me about your childhood home." },
  { category: "story2", text: "I would appreciate it if you could tell me more about that festival." },
  { category: "story2", text: "Would you mind sending me a photo of the lake?" },
  { category: "story2", text: "I have a favour to ask: could you recommend a good film?" },
  { category: "story2", text: "I am so grateful for your help with my essay." },
  { category: "story2", text: "My hospital stay was long, but the nurses were kind and the bill was covered by insurance." },
  { category: "story2", text: "Customs held my package for a week, but it finally arrived." },
  { category: "story2", text: "I got a small inheritance from my grandmother and bought a bicycle." },
  { category: "story2", text: "Our business has a new supplier and the shipment arrived on time." },
  { category: "story2", text: "I use PayPal to pay for my online classes." },
  { category: "story2", text: "I bought a gift card for my niece, and she loved it." },
  { category: "story2", text: "Bitcoin was mentioned on the news again; I still do not understand it." },
]
