import { describe, it, expect } from 'vitest'
import { analyzeSolicitations } from './solicitation'
import { DENY, ALLOW } from './corpus'

describe('Pattern Library — financial solicitation (adversarial corpus)', () => {
  describe('DENY corpus: asks the recipient to provide / move value', () => {
    for (const c of DENY) {
      it(`[${c.category}] ${c.text.slice(0, 90).replace(/\n/g, ' ')}`, () => {
        expect(analyzeSolicitations(c.text).hits.length).toBeGreaterThan(0)
      })
    }
  })

  describe('ALLOW corpus: talks ABOUT money without asking the recipient for value', () => {
    for (const c of ALLOW) {
      it(`[${c.category}] ${c.text.slice(0, 90).replace(/\n/g, ' ')}`, () => {
        expect(analyzeSolicitations(c.text).hits).toEqual([])
      })
    }
  })

  it('every close pair has one DENY and one ALLOW member', () => {
    const ids = new Set([...DENY, ...ALLOW].map((c) => c.pair).filter(Boolean))
    for (const id of ids) {
      expect(DENY.filter((c) => c.pair === id).length, `deny side of ${id}`).toBe(1)
      expect(ALLOW.filter((c) => c.pair === id).length, `allow side of ${id}`).toBe(1)
    }
  })
})
