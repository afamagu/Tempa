import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'
import es from '@/messages/es.json'
import pt from '@/messages/pt.json'
import { WRITING_STYLE_ONBOARDING_HREF } from '@/lib/onboarding'

const root = process.cwd()
const profileForm = readFileSync(path.join(root, 'app/profile/profile-form.tsx'), 'utf8')
const questionPage = readFileSync(path.join(root, 'app/profile/question/page.tsx'), 'utf8')

describe('Phase 15 — landing/onboarding final polish', () => {
  it('finishes the first-use journey at Home after Writing Style', () => {
    expect(WRITING_STYLE_ONBOARDING_HREF).toBe('/profile/writing-style?next=%2Fhome')
    expect(questionPage).toContain("if (profile.onboarding_stage === 'complete') redirect('/home')")
    expect(questionPage).not.toContain("redirect('/minds')")
  })

  it('teaches the finite correspondence rule during profile onboarding', () => {
    expect(profileForm).toContain("t('correspondenceCapacity')")
    expect(en.ProfileSetup.correspondenceCapacity).toContain('up to five active correspondences')
    expect(en.ProfileSetup.correspondenceCapacity).toContain('The Room')
    expect(en.ProfileSetup.correspondenceCapacity).toContain('The Board')
  })

  it('keeps the finite-correspondence education localized in every supported interface language', () => {
    for (const dictionary of [en, fr, es, pt]) {
      expect(dictionary.ProfileSetup.correspondenceCapacity.trim().length).toBeGreaterThan(30)
    }
  })

  it('keeps core correspondence framing non-paywalled and finite', () => {
    expect(en.ProfileSetup.correspondenceCapacity.toLowerCase()).not.toContain('premium')
    expect(en.ProfileSetup.correspondenceCapacity.toLowerCase()).not.toContain('upgrade')
    expect(en.ProfileSetup.correspondenceCapacity.toLowerCase()).not.toContain('unlimited')
  })
})
