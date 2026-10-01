import { describe, expect, it } from 'vitest'
import { correspondentTrigger } from './correspondent-trigger'

describe('correspondent trigger in ordinary prose', () => {
  it('supports @ and a single * alias, Unicode and multiword pseudonyms', () => {
    expect(correspondentTrigger('Hello @Mia')).toEqual({ from: 6, to: 10, query: 'Mia' })
    expect(correspondentTrigger('*Evening Quill')).toEqual({ from: 0, to: 14, query: 'Evening Quill' })
    expect(correspondentTrigger('Hello @Élodie')).toEqual({ from: 6, to: 13, query: 'Élodie' })
  })
  it('does not treat an email address or bold syntax as a person trigger', () => {
    expect(correspondentTrigger('email@example')).toBeNull()
    expect(correspondentTrigger('**bold')).toBeNull()
    expect(correspondentTrigger('word*part')).toBeNull()
  })
  it('uses the caret rather than the end of an existing draft', () => {
    expect(correspondentTrigger('Hello @Mi, rest of letter', 9)).toEqual({ from: 6, to: 9, query: 'Mi' })
  })
})
