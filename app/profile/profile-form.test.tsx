import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'profile-form.tsx'), 'utf8')

describe('minimal first-arrival identity', () => {
  it('asks for name, country, languages and a truthful writing approach', () => {
    expect(source).toContain('pseudonym')
    expect(source).toContain('SearchableSelect id="country"')
    expect(source).toContain('SearchableMultiSelect id="languages"')
    expect(source).toContain('WRITING_STYLE_OPTIONS.some(x=>x.value===aiPreference)')
  })

  it('retains real pseudonym validation and server-checked uniqueness', () => {
    expect(source).toContain('isReservedPseudonym(name)')
    expect(source).toContain("rpc('is_pseudonym_available'")
    expect(source).toContain("rpc('suggest_available_pseudonyms'")
  })

  it('cannot falsify a writing-method declaration as a convenient default', () => {
    expect(source).toContain("useState('')")
    expect(source).toContain("if(!WRITING_STYLE_OPTIONS.some(x=>x.value===aiPreference))")
    expect(source).toContain('ai_preference:aiPreference')
  })

  it('does not require a photograph, essay, typography, interests or writing rhythm', () => {
    expect(source).not.toContain('persistGeneratedMark')
    expect(source).not.toContain('WritingRhythmChoice')
    expect(source).not.toContain("router.push('/profile/question')")
    expect(source).not.toContain('readingInterestsCount')
    expect(source).not.toContain('getFlagshipQuestion')
  })

  it('creates only the member’s own profile and continues to the durable welcome', () => {
    expect(source).toContain('id:userId')
    expect(source).toContain("onboarding_stage:'complete'")
    expect(source).toContain("router.replace('/welcome')")
  })

  it('has restrained, actionable error feedback without technical database text', () => {
    expect(source).toContain('role="alert"')
    expect(source).toContain("arrival('saveError')")
  })
})
