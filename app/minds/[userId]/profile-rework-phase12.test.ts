import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('Phase 12 public profile hierarchy', () => {
  it('puts identity first and metadata in a lower About section', () => {
    const header = source.indexOf('<header className="flex items-start gap-4">')
    const featured = source.indexOf('id="profile-featured-writing"')
    const about = source.indexOf('id="profile-about"')

    expect(header).toBeGreaterThan(-1)
    expect(featured).toBeGreaterThan(header)
    expect(about).toBeGreaterThan(featured)

    const headerBlock = source.slice(header, featured)
    expect(headerBlock).not.toContain('{demographics')
    expect(headerBlock).not.toContain('Speaks {languages')
    expect(headerBlock).not.toContain('<InterestsDisclosure')
  })

  it('keeps strongest writing ahead of authored Questions, Dispatches and other responses', () => {
    const featured = source.indexOf('id="profile-featured-writing"')
    const questions = source.indexOf('<ProfileQuestions')
    const dispatches = source.indexOf('>Dispatches</p>')
    const otherResponses = source.indexOf('<OtherAnswersDisclosure')

    expect(featured).toBeGreaterThan(-1)
    expect(questions).toBeGreaterThan(featured)
    expect(dispatches).toBeGreaterThan(questions)
    expect(otherResponses).toBeGreaterThan(dispatches)
  })

  it('puts correspondence availability and rhythm below the writing', () => {
    const otherResponses = source.indexOf('<OtherAnswersDisclosure')
    const correspondence = source.indexOf('id="profile-correspondence"')
    const about = source.indexOf('id="profile-about"')

    expect(correspondence).toBeGreaterThan(otherResponses)
    expect(about).toBeGreaterThan(correspondence)
    expect(source).toContain('Usual writing rhythm:')
    expect(source).toContain('Open to a first letter')
    expect(source).toContain('Not taking another first letter right now')
  })

  it('has no detached generic Write to person button', () => {
    expect(source).not.toContain('Write to {profile.pseudonym}')
    expect(source).toContain('writeHref={primaryWriteHref}')
  })

  it('routes a paused relationship back to the existing correspondence instead of first-contact UI', () => {
    expect(source).toContain("lifecycle?.status === 'paused'")
    expect(source).toContain('View paused correspondence')
    expect(source).toContain('alreadyCorresponding: alreadyCorresponding || pausedCorrespondence')
  })

  it('uses one batched authoritative answer-origin read instead of one RPC per answer', () => {
    expect(source).toContain("supabase.rpc('get_profile_writable_answer_ids'")
    expect(source).not.toContain("rawAnswers.map(async")
  })
})
