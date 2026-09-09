import { describe, it, expect } from 'vitest'
import { COUNTRY_OPTIONS, findCountryIsoCode } from './data'

describe('findCountryIsoCode', () => {
  it('resolves United States to US, from the same COUNTRY_OPTIONS entry the picker itself offers', () => {
    expect(findCountryIsoCode('United States')).toBe('US')
  })

  it('resolves South Africa to ZA', () => {
    expect(findCountryIsoCode('South Africa')).toBe('ZA')
  })

  it('returns null for a name that is not one of COUNTRY_OPTIONS\' own values', () => {
    expect(findCountryIsoCode('Not A Real Country')).toBeNull()
  })

  it('returns null for an empty selection', () => {
    expect(findCountryIsoCode('')).toBeNull()
  })

  it('every COUNTRY_OPTIONS entry round-trips through its own isoCode — no entry the picker can produce is unresolvable', () => {
    for (const option of COUNTRY_OPTIONS) {
      expect(findCountryIsoCode(option.value)).toBe(option.isoCode)
    }
  })
})
