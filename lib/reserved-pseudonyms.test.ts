import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isReservedPseudonym, RESERVED_PSEUDONYM_PREFIXES } from './reserved-pseudonyms'

describe('reserved house identities', () => {
  it.each(['Tempa', 'TEMPA', 'T e m p a', 'Tempa Support', 'Tempa99', 'Lady Larkspur', 'lady-larkspur', ' Lady Larkspurr ', 'LadyLarkspur42'])( 'refuses %s', (name) => {
    expect(isReservedPseudonym(name)).toBe(true)
  })
  it.each(['Evening Quill', 'Quiet Harbor', 'Larkspur', 'Lady Bird', 'Temperance', 'Contemporary', '', 'Mia'])('allows %s', (name) => {
    expect(isReservedPseudonym(name)).toBe(false)
  })
  it('pins the client prefixes to the SQL rule', () => {
    const sql = readFileSync(new URL('../docs/sql/2026-10-30-reserved-pseudonyms.sql', import.meta.url), 'utf8')
    expect([...sql.matchAll(/like '([a-z]+)%'/g)].map((m) => m[1])).toEqual([...RESERVED_PSEUDONYM_PREFIXES])
  })
})
