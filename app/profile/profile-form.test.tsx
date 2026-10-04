import { describe, it, expect } from 'vitest'
import { validateRequiredFields } from './profile-form'
import { MIN_RECOMMENDED_INTERESTS, MAX_INTERESTS } from '@/lib/interests'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'profile-form.tsx'), 'utf8')

function validState() {
  return {
    country: 'United States',
    languages: ['English'],
    intentSelections: ['Meaningful friendship'],
    readingInterestsCount: MIN_RECOMMENDED_INTERESTS,
    aiPreference: 'self_written',
    receivingPreference: 'any',
    writingRhythm: 'one_week',
  }
}

describe('validateRequiredFields', () => {
  it('returns no errors when every required section is complete', () => {
    expect(validateRequiredFields(validState())).toEqual({})
  })

  it('country: specific message, not a generic combined one', () => {
    const errors = validateRequiredFields({ ...validState(), country: '' })
    expect(errors.country).toBe('Choose your country.')
  })

  it('languages: specific message', () => {
    expect(validateRequiredFields({ ...validState(), languages: [] }).languages)
      .toBe('Add at least one language.')
  })

  it('intent: specific message', () => {
    expect(validateRequiredFields({ ...validState(), intentSelections: [] }).intent)
      .toBe('Choose what brings you to Tempa.')
  })

  it('reading interests use the actual new-profile range', () => {
    const errors = validateRequiredFields({ ...validState(), readingInterestsCount: 0 })
    expect(errors.interests).toBe(
      `Choose at least ${MIN_RECOMMENDED_INTERESTS} things you enjoy reading about (up to ${MAX_INTERESTS}).`
    )
  })

  it('writing style: specific message', () => {
    expect(validateRequiredFields({ ...validState(), aiPreference: '' }).writingStyle)
      .toBe('Choose how you usually write your letters.')
  })

  it('receiving preference: specific message', () => {
    expect(validateRequiredFields({ ...validState(), receivingPreference: '' }).receiving)
      .toBe("Choose what you're comfortable receiving.")
  })

  it('writing rhythm is required and rejects the retired unbounded option', () => {
    expect(validateRequiredFields({ ...validState(), writingRhythm: '' }).rhythm)
      .toBe('Choose your usual writing rhythm.')
    expect(validateRequiredFields({ ...validState(), writingRhythm: 'whenever' }).rhythm)
      .toBe('Choose your usual writing rhythm.')
  })

  it('reports every incomplete section at once in DOM order', () => {
    const errors = validateRequiredFields({
      ...validState(),
      country: '',
      languages: [],
      aiPreference: '',
      receivingPreference: '',
      writingRhythm: '',
    })
    expect(Object.keys(errors)).toEqual([
      'country',
      'languages',
      'writingStyle',
      'receiving',
      'rhythm',
    ])
  })
})

describe('new-profile onboarding handoff', () => {
  it('stores rhythm on the profile before continuing to the Mark step', () => {
    expect(source).toContain('writing_rhythm: writingRhythm')
    expect(source).toContain("onboarding_stage: 'mark'")
    expect(source).toContain("router.push('/profile/mark')")
  })

  it('renders the rhythm choice inside the correspondence section', () => {
    expect(source).toContain('<WritingRhythmChoice error={fieldErrors.rhythm} />')
  })
})
