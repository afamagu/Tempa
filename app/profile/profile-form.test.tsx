import { describe, it, expect } from 'vitest'
import { validateRequiredFields } from './profile-form'
import { MIN_RECOMMENDED_INTERESTS, MAX_INTERESTS } from '@/lib/interests'

// Onboarding & First-Use checkpoint (Section K) — extracted as a pure,
// independently-testable function (same rationale as canWriteToMind,
// app/minds/[userId]/page.tsx) specifically so each required section's
// OWN specific message can be proven without rendering the whole form.
// Replaces the single generic "Please fill in the required fields."
// check that previously collapsed all 7 sections into one message.
function validState() {
  return {
    country: 'United States',
    ageRange: '25-34',
    languages: ['English'],
    intentSelections: ['Making a pen pal'],
    readingInterestsCount: MIN_RECOMMENDED_INTERESTS,
    aiPreference: 'Entirely my own words',
    receivingPreference: 'Anything',
  }
}

describe('validateRequiredFields — one specific message per section, never a generic combined one', () => {
  it('returns no errors when every required section is complete', () => {
    expect(validateRequiredFields(validState())).toEqual({})
  })

  it('country: specific message, not the old generic one', () => {
    const errors = validateRequiredFields({ ...validState(), country: '' })
    expect(errors.country).toBe('Choose your country.')
    expect(Object.values(errors)).not.toContain('Please fill in the required fields.')
  })

  it('age: specific message', () => {
    const errors = validateRequiredFields({ ...validState(), ageRange: '' })
    expect(errors.age).toBe('Choose your age range.')
  })

  it('languages: specific message ("Add at least one language.")', () => {
    const errors = validateRequiredFields({ ...validState(), languages: [] })
    expect(errors.languages).toBe('Add at least one language.')
  })

  it('intent: specific message ("Choose what brings you to Tempa.")', () => {
    const errors = validateRequiredFields({ ...validState(), intentSelections: [] })
    expect(errors.intent).toBe('Choose what brings you to Tempa.')
  })

  it('reading interests: specific message naming the actual 3-8 new-profile range', () => {
    const errors = validateRequiredFields({ ...validState(), readingInterestsCount: 0 })
    expect(errors.interests).toBe(
      `Choose at least ${MIN_RECOMMENDED_INTERESTS} things you enjoy reading about (up to ${MAX_INTERESTS}).`
    )
  })

  it('reading interests: also invalid one below the minimum (2), not just zero', () => {
    const errors = validateRequiredFields({ ...validState(), readingInterestsCount: MIN_RECOMMENDED_INTERESTS - 1 })
    expect(errors.interests).toBeDefined()
  })

  it('writing style: specific message', () => {
    const errors = validateRequiredFields({ ...validState(), aiPreference: '' })
    expect(errors.writingStyle).toBe('Choose how you usually write your letters.')
  })

  it('receiving preference: specific message', () => {
    const errors = validateRequiredFields({ ...validState(), receivingPreference: '' })
    expect(errors.receiving).toBe("Choose what you're comfortable receiving.")
  })

  it('reports every incomplete section at once, not just the first — the caller decides which one to scroll to', () => {
    const errors = validateRequiredFields({
      ...validState(),
      country: '',
      languages: [],
      receivingPreference: '',
    })
    expect(Object.keys(errors).sort()).toEqual(['country', 'languages', 'receiving'].sort())
  })

  it('the error object\'s key order matches the fields\' own top-to-bottom DOM order, so "the first incomplete requirement" is unambiguous', () => {
    const errors = validateRequiredFields({
      ...validState(),
      languages: [],
      aiPreference: '',
      country: '',
    })
    // DOM order is country, age, languages, intent, interests,
    // writingStyle, receiving — regardless of which order the caller
    // happened to set fields invalid in above.
    expect(Object.keys(errors)).toEqual(['country', 'languages', 'writingStyle'])
  })
})
