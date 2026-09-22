import { describe, it, expect } from 'vitest'
import {
  isValidCalendarDate,
  compareDates,
  calculateAge,
  isAdultOn,
  isPlausibleDob,
  eligibleOnDate,
  deriveAgeRangeBucket,
  MINIMUM_ADULT_AGE,
} from './age'

describe('isValidCalendarDate', () => {
  it('accepts an ordinary real date', () => {
    expect(isValidCalendarDate({ year: 1990, month: 11, day: 13 })).toBe(true)
  })

  it('accepts February 29 in a leap year', () => {
    expect(isValidCalendarDate({ year: 2000, month: 2, day: 29 })).toBe(true)
    expect(isValidCalendarDate({ year: 2024, month: 2, day: 29 })).toBe(true)
  })

  it('rejects February 29 in a non-leap year', () => {
    expect(isValidCalendarDate({ year: 2001, month: 2, day: 29 })).toBe(false)
    expect(isValidCalendarDate({ year: 1900, month: 2, day: 29 })).toBe(false) // divisible by 100, not 400
  })

  it('rejects month 0, month 13, day 0, and a day beyond the month length', () => {
    expect(isValidCalendarDate({ year: 2000, month: 0, day: 10 })).toBe(false)
    expect(isValidCalendarDate({ year: 2000, month: 13, day: 10 })).toBe(false)
    expect(isValidCalendarDate({ year: 2000, month: 4, day: 0 })).toBe(false)
    expect(isValidCalendarDate({ year: 2000, month: 4, day: 31 })).toBe(false) // April has 30 days
  })

  it('rejects non-integer components', () => {
    expect(isValidCalendarDate({ year: 2000.5, month: 4, day: 10 })).toBe(false)
    expect(isValidCalendarDate({ year: 2000, month: 4.2, day: 10 })).toBe(false)
  })
})

describe('compareDates', () => {
  it('orders by year, then month, then day', () => {
    expect(compareDates({ year: 1990, month: 1, day: 1 }, { year: 1991, month: 1, day: 1 })).toBe(-1)
    expect(compareDates({ year: 1990, month: 2, day: 1 }, { year: 1990, month: 1, day: 1 })).toBe(1)
    expect(compareDates({ year: 1990, month: 1, day: 5 }, { year: 1990, month: 1, day: 5 })).toBe(0)
  })
})

describe('calculateAge — calendar-date correct, never a 365-day-division approximation', () => {
  it('exact 18th birthday today is 18, not 17', () => {
    expect(calculateAge({ year: 2008, month: 9, day: 21 }, { year: 2026, month: 9, day: 21 })).toBe(18)
  })

  it('one day before the 18th birthday is still 17', () => {
    expect(calculateAge({ year: 2008, month: 9, day: 21 }, { year: 2026, month: 9, day: 20 })).toBe(17)
  })

  it('one day after the 18th birthday is 18', () => {
    expect(calculateAge({ year: 2008, month: 9, day: 21 }, { year: 2026, month: 9, day: 22 })).toBe(18)
  })

  it('a birth month later in the year than today has not yet had this year\'s birthday', () => {
    expect(calculateAge({ year: 2008, month: 12, day: 1 }, { year: 2026, month: 9, day: 21 })).toBe(17)
  })

  it('a leap-day birth (Feb 29) turns 18 correctly on Feb 28/29 boundaries', () => {
    // 2008 is a leap year; 2026 is not. Calendar convention treats the
    // birthday as having occurred once the date reaches Feb 28 or later
    // in a non-leap year (month equal, day >= 28 satisfies day >= 29
    // only when the year itself has a 29th — same-month/day>=dob.day
    // comparison with dob.day = 29 means Feb 28 in a non-leap today
    // year does NOT yet satisfy day >= 29, so the birthday is treated
    // as not-yet-occurred until March 1 of a non-leap year. This is a
    // deliberate, documented choice — see eligibleOnDate's own handling
    // of the mirror-image case.
    expect(calculateAge({ year: 2008, month: 2, day: 29 }, { year: 2026, month: 3, day: 1 })).toBe(18)
    expect(calculateAge({ year: 2008, month: 2, day: 29 }, { year: 2026, month: 2, day: 28 })).toBe(17)
  })
})

describe('isAdultOn', () => {
  it('true at exactly 18, false at 17', () => {
    expect(isAdultOn({ year: 2008, month: 9, day: 21 }, { year: 2026, month: 9, day: 21 })).toBe(true)
    expect(isAdultOn({ year: 2008, month: 9, day: 21 }, { year: 2026, month: 9, day: 20 })).toBe(false)
  })

  it(`MINIMUM_ADULT_AGE is ${18}`, () => {
    expect(MINIMUM_ADULT_AGE).toBe(18)
  })
})

describe('isPlausibleDob — real, non-future, not-implausibly-old', () => {
  const today = { year: 2026, month: 9, day: 21 }

  it('accepts an ordinary adult DOB', () => {
    expect(isPlausibleDob({ year: 1990, month: 6, day: 15 }, today)).toBe(true)
  })

  it('rejects an impossible calendar date', () => {
    expect(isPlausibleDob({ year: 2000, month: 2, day: 30 }, today)).toBe(false)
  })

  it('rejects a future date', () => {
    expect(isPlausibleDob({ year: 2027, month: 1, day: 1 }, today)).toBe(false)
  })

  it('rejects today itself plus one day (still future)', () => {
    expect(isPlausibleDob({ year: 2026, month: 9, day: 22 }, today)).toBe(false)
  })

  it('accepts today itself (age 0, still a real, non-future date)', () => {
    expect(isPlausibleDob({ year: 2026, month: 9, day: 21 }, today)).toBe(true)
  })

  it('rejects an implausibly old DOB', () => {
    expect(isPlausibleDob({ year: 1800, month: 1, day: 1 }, today)).toBe(false)
  })

  it('accepts a DOB exactly at the reasonable-age boundary', () => {
    expect(isPlausibleDob({ year: 1906, month: 9, day: 21 }, today)).toBe(true) // exactly 120
  })
})

describe('eligibleOnDate — exactly dob + 18 years, leap-day-aware', () => {
  it('an ordinary DOB adds exactly 18 years', () => {
    expect(eligibleOnDate({ year: 2010, month: 5, day: 4 })).toEqual({ year: 2028, month: 5, day: 4 })
  })

  it('a Feb 29 birth resolves its +18-year date to MARCH 1 (independent audit correction — previously wrongly Feb 28)', () => {
    // A Feb 29 birth requires a leap dob year; since 18 is not a
    // multiple of 4, dob.year + 18 can never ALSO be a leap year (both
    // being divisible by 4 would require their difference, 18, to be
    // divisible by 4 too) — so this branch is the only reachable one
    // for +18 years specifically, and is exercised with two different
    // leap dob years to confirm it is not a one-off coincidence.
    expect(eligibleOnDate({ year: 2008, month: 2, day: 29 })).toEqual({ year: 2026, month: 3, day: 1 })
    expect(eligibleOnDate({ year: 2012, month: 2, day: 29 })).toEqual({ year: 2030, month: 3, day: 1 })
  })

  it('is self-consistent with calculateAge: calling calculateAge on eligibleOnDate\'s own result always yields exactly MINIMUM_ADULT_AGE — the property the previous Feb-28 answer violated', () => {
    const leapDobs = [
      { year: 2008, month: 2, day: 29 },
      { year: 2012, month: 2, day: 29 },
      { year: 2000, month: 2, day: 29 },
    ]
    for (const dob of leapDobs) {
      expect(calculateAge(dob, eligibleOnDate(dob))).toBe(MINIMUM_ADULT_AGE)
    }
    // And the day before (February 28 of that same year, since
    // eligibleOnDate always resolves a Feb-29 dob to March 1) must
    // still be 17 — the boundary is exact, not merely "eventually
    // true."
    for (const dob of leapDobs) {
      const eligible = eligibleOnDate(dob)
      const dayBefore = { year: eligible.year, month: 2, day: 28 }
      expect(calculateAge(dob, dayBefore)).toBe(MINIMUM_ADULT_AGE - 1)
    }
  })

  it('ordinary (non-Feb-29) birthdays are completely unaffected by this convention', () => {
    expect(eligibleOnDate({ year: 2010, month: 12, day: 25 })).toEqual({ year: 2028, month: 12, day: 25 })
    expect(eligibleOnDate({ year: 2010, month: 1, day: 1 })).toEqual({ year: 2028, month: 1, day: 1 })
  })
})

describe('February 29 boundary — explicit cross-cutting proof (independent audit correction)', () => {
  const feb29Dob = { year: 2008, month: 2, day: 29 }

  it('Feb 29 birth, Feb 28 of the non-leap +18 target year → NOT yet 18', () => {
    expect(calculateAge(feb29Dob, { year: 2026, month: 2, day: 28 })).toBe(17)
    expect(isAdultOn(feb29Dob, { year: 2026, month: 2, day: 28 })).toBe(false)
  })

  it('March 1 of that same non-leap target year → 18', () => {
    expect(calculateAge(feb29Dob, { year: 2026, month: 3, day: 1 })).toBe(18)
    expect(isAdultOn(feb29Dob, { year: 2026, month: 3, day: 1 })).toBe(true)
  })

  it('the age-range bucket boundary for a leap-day adult follows the exact same convention: still 17-equivalent (unbucketed) on Feb 28, bucketed as an adult from March 1', () => {
    const ageOnFeb28 = calculateAge(feb29Dob, { year: 2026, month: 2, day: 28 })
    const ageOnMarch1 = calculateAge(feb29Dob, { year: 2026, month: 3, day: 1 })
    expect(ageOnFeb28).toBe(17)
    expect(ageOnMarch1).toBe(18)
    expect(deriveAgeRangeBucket(ageOnMarch1)).toBe('18-24')
  })
})

describe('deriveAgeRangeBucket', () => {
  it('buckets ages into the six canonical ranges, boundary-correct', () => {
    expect(deriveAgeRangeBucket(18)).toBe('18-24')
    expect(deriveAgeRangeBucket(24)).toBe('18-24')
    expect(deriveAgeRangeBucket(25)).toBe('25-34')
    expect(deriveAgeRangeBucket(34)).toBe('25-34')
    expect(deriveAgeRangeBucket(35)).toBe('35-44')
    expect(deriveAgeRangeBucket(44)).toBe('35-44')
    expect(deriveAgeRangeBucket(45)).toBe('45-54')
    expect(deriveAgeRangeBucket(54)).toBe('45-54')
    expect(deriveAgeRangeBucket(55)).toBe('55-64')
    expect(deriveAgeRangeBucket(64)).toBe('55-64')
    expect(deriveAgeRangeBucket(65)).toBe('65+')
    expect(deriveAgeRangeBucket(90)).toBe('65+')
  })
})
