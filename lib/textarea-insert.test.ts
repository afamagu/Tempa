import { describe, it, expect } from 'vitest'
import { insertAtCursor } from './textarea-insert'

describe('insertAtCursor', () => {
  it('inserts at the cursor position when nothing is selected (start === end)', () => {
    const result = insertAtCursor('Hello world', 5, 5, '!')
    expect(result.value).toBe('Hello! world')
    expect(result.cursor).toBe(6)
  })

  it('replaces a selected range with the inserted text', () => {
    const result = insertAtCursor('Hello world', 0, 5, 'Goodbye')
    expect(result.value).toBe('Goodbye world')
    expect(result.cursor).toBe(7)
  })

  it('inserts at the very end of an empty selection at the end of the string', () => {
    const result = insertAtCursor('Hello', 5, 5, ' 🙂')
    expect(result.value).toBe('Hello 🙂')
    // UTF-16 code-unit length, matching a real textarea's own
    // selectionStart/selectionEnd semantics — most emoji are a
    // surrogate pair (2 code units), so " 🙂" is 3, not 2.
    expect(result.cursor).toBe(8)
  })

  it('inserts at the very start of the string', () => {
    const result = insertAtCursor('world', 0, 0, 'Hello ')
    expect(result.value).toBe('Hello world')
    expect(result.cursor).toBe(6)
  })

  it('returns a cursor position that lands immediately after the inserted text, not at the end of the whole value', () => {
    const result = insertAtCursor('Start End', 6, 6, 'MIDDLE')
    expect(result.value).toBe('Start MIDDLEEnd')
    expect(result.cursor).toBe(12)
  })
})
