// Adult Eligibility + Legal Acceptance Gate — pure, calendar-correct age
// math. This module is deliberately DOM/DB/network-free (matching this
// codebase's established "extract pure logic for testability"
// convention — lib/dispatches.ts's isWithinDispatchEditWindow,
// lib/onboarding.ts's resolveOnboardingDestination, ...) so every
// boundary case (exact 18th birthday, leap-day births, month-length
// edge cases) is directly unit-testable without a database.
//
// IMPORTANT: this module's calculations are for CLIENT-SIDE UX only —
// instant "enter a valid date" feedback before a submission ever
// reaches the server. The AUTHORITATIVE eligibility decision is made
// server-side, inside submit_dob_eligibility (docs/sql/2026-09-21-
// adult-eligibility-and-legal-acceptance.sql), using tempa_private.
// calculate_age against current_date — never the browser's clock, and
// never this module. calculate_age is DELIBERATELY NOT Postgres's
// built-in age() (independent audit correction): it transliterates
// this file's own calculateAge algorithm line-for-line in SQL, so the
// two are guaranteed to agree by construction — including the March-1-
// not-February-28 leap-day boundary a February 29 DOB produces (see
// calculateAge's own comment below) — rather than by assuming
// Postgres's age() happens to implement the same convention, which was
// never verified against a live database. That duplication (this
// module's algorithm, re-expressed in SQL) is intentional and
// documented in both places, not an oversight.

export type DateOfBirth = { year: number; month: number; day: number }

export const MINIMUM_ADULT_AGE = 18

/** No DOB implying an age older than this is accepted — a restrained,
 * generous upper bound (not a strict "no one could possibly be this
 * old" claim), just enough to catch obvious fat-fingered years
 * (e.g. a four-digit typo) without rejecting any genuine member. */
const MAX_REASONABLE_AGE = 120

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** A real calendar date — integer year/month/day, month in [1,12], day
 * within that month's actual length (leap-year-aware for February).
 * Deliberately does NOT accept a Date object or a timestamp: DOB is a
 * calendar DATE, never a moment in time, so there is no timezone to
 * get wrong here in the first place. */
export function isValidCalendarDate(dob: DateOfBirth): boolean {
  const { year, month, day } = dob
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12) return false
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]
  if (day < 1 || day > maxDay) return false
  return true
}

/** -1 if a < b, 0 if equal, 1 if a > b — plain calendar-date comparison,
 * no timezone/clock involved. */
export function compareDates(a: DateOfBirth, b: DateOfBirth): -1 | 0 | 1 {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1
  if (a.month !== b.month) return a.month < b.month ? -1 : 1
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  return 0
}

/**
 * Calendar-correct age on a given date — NOT `(today - dob) / 365`,
 * which drifts across leap years. A birthday "counts" the moment the
 * month/day reaches or passes the birth month/day, regardless of leap
 * years in between.
 *
 * TEMPA-WIDE FEBRUARY 29 CONVENTION: needs no special-casing here — a
 * February 29 DOB compared against a non-leap year's February 28
 * (`today.day >= dob.day` is `28 >= 29`, false) has NOT yet had its
 * birthday that year; March 1 (`today.month > dob.month`) is the first
 * date the comparison succeeds. This function is the SOURCE of that
 * convention — `eligibleOnDate` below, and SQL's `tempa_private.
 * calculate_age`/`calculate_eligible_on`, are all built to agree with
 * it, not the other way around.
 */
export function calculateAge(dob: DateOfBirth, today: DateOfBirth): number {
  let age = today.year - dob.year
  const hadBirthdayThisYear = today.month > dob.month || (today.month === dob.month && today.day >= dob.day)
  if (!hadBirthdayThisYear) age -= 1
  return age
}

export function isAdultOn(dob: DateOfBirth, today: DateOfBirth): boolean {
  return calculateAge(dob, today) >= MINIMUM_ADULT_AGE
}

/** A DOB is acceptable input at all (independent of adult/minor
 * status) when it is a real calendar date, not in the future, and not
 * implausibly old. */
export function isPlausibleDob(dob: DateOfBirth, today: DateOfBirth): boolean {
  if (!isValidCalendarDate(dob)) return false
  if (compareDates(dob, today) > 0) return false
  return calculateAge(dob, today) <= MAX_REASONABLE_AGE
}

/**
 * The calendar date on which a minor's account becomes eligible for a
 * fresh, neutral DOB screening again — exactly `dob + 18 years`.
 *
 * TEMPA-WIDE CONVENTION (independent audit correction — this MUST
 * agree with `calculateAge` above, with SQL's `tempa_private.
 * calculate_age`/`calculate_eligible_on`, and with SQL's age-range
 * derivation): a February 29 birth landing on a non-leap target year
 * resolves to MARCH 1, never February 28. This is not an arbitrary
 * choice — `calculateAge`'s own field comparison (`today.day >=
 * dob.day`) never treats February 28 as having reached a February 29
 * birthday (28 is never >= 29), so February 28 is provably still age
 * 17. March 1 is the first date for which `calculateAge` reports 18,
 * which is what makes `eligibleOnDate(dob)` and
 * `calculateAge(dob, eligibleOnDate(dob))` self-consistent: calling
 * the latter on the former's result is guaranteed to equal
 * MINIMUM_ADULT_AGE. A previous version of this function resolved to
 * February 28, disagreeing with `calculateAge`'s own boundary — fixed
 * here.
 */
export function eligibleOnDate(dob: DateOfBirth): DateOfBirth {
  const year = dob.year + MINIMUM_ADULT_AGE
  if (dob.month === 2 && dob.day === 29 && !isLeapYear(year)) {
    return { year, month: 3, day: 1 }
  }
  return { year, month: dob.month, day: dob.day }
}

export type AgeRangeBucket = '18-24' | '25-34' | '35-44' | '45-54' | '55-64' | '65+'

/**
 * The ONE canonical age-range derivation rule (Adult Eligibility +
 * Legal Acceptance Gate) — mirrored in SQL by
 * tempa_private.derive_age_range, which performs the same bucketing so
 * profiles.age_range can be populated/kept in sync server-side without
 * ever trusting a client-supplied bucket. Only meaningful for an adult
 * age (>= MINIMUM_ADULT_AGE); this module never derives a bucket for a
 * minor, since a minor's account never reaches profile creation.
 */
export function deriveAgeRangeBucket(age: number): AgeRangeBucket {
  if (age < 25) return '18-24'
  if (age < 35) return '25-34'
  if (age < 45) return '35-44'
  if (age < 55) return '45-54'
  if (age < 65) return '55-64'
  return '65+'
}
