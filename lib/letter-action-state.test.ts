import { describe, expect, it } from 'vitest'
import { resolveLetterActionState } from './letters'

describe('resolveLetterActionState — first-contact reply window', () => {
  it('keeps a delivered, still-live first letter replyable for its recipient', () => {
    expect(resolveLetterActionState(false, true, true, 'sent', null)).toEqual({
      showFirstContactResponse: true,
      showWriteQuill: false,
    })
  })

  it('keeps a system-expired first letter replyable without pretending correspondence is established', () => {
    expect(resolveLetterActionState(false, true, true, 'closed', 'system')).toEqual({
      showFirstContactResponse: true,
      showWriteQuill: false,
    })
  })

  it('keeps an explicit recipient rejection terminal', () => {
    expect(resolveLetterActionState(false, true, true, 'closed', 'recipient')).toEqual({
      showFirstContactResponse: false,
      showWriteQuill: false,
    })
  })

  it('never exposes a recipient reply action to the original sender', () => {
    expect(resolveLetterActionState(false, true, false, 'closed', 'system')).toEqual({
      showFirstContactResponse: false,
      showWriteQuill: false,
    })
  })

  it('established correspondence uses the quill and never the first-contact response', () => {
    expect(resolveLetterActionState(true, true, true, 'sent', null)).toEqual({
      showFirstContactResponse: false,
      showWriteQuill: true,
    })
  })
})
