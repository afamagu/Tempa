import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('People page — discovery information architecture', () => {
  it('the visible heading is People, never Minds', () => {
    expect(source).toContain('>People</h1>')
    expect(source).not.toMatch(/>Minds<\/h1>/)
  })

  it('keeps response management outside People', () => {
    expect(source).not.toContain('MindsTabs')
    expect(source).not.toContain('QuestionWorkspace')
    expect(source).not.toContain('/minds?view=')
  })

  it('shows the People introduction only until its guide completion is persisted', () => {
    expect(source).toContain("import { hasCompletedGuide } from '@/lib/guide'")
    expect(source).toContain("hasCompletedGuide(supabase, user.id, 'people')")
    expect(source).toContain('{!introSeen && (')
    expect(source).toContain('<FeatureIntroduction guideKey="people"')
    expect(source).toContain('People worth writing to')
    expect(source).toContain('Start exploring')
  })

  it('preserves correspondence, moderation, pagination and stable-shuffle boundaries', () => {
    expect(source).toContain('getActiveCorrespondencePartnerIds')
    expect(source).toContain('getContactedAnswerIds')
    expect(source).toContain("moderation_status', 'visible'")
    expect(source).toContain('BATCH_SIZE')
    expect(source).toContain('stableShuffle')
  })

  it('never introduces popularity/follower/like ranking', () => {
    const lower = source.toLowerCase()
    expect(lower).not.toContain('popularity')
    expect(source).not.toMatch(/\bFollow\b/)
    expect(source).not.toContain('followerCount')
    expect(source).not.toMatch(/\blikeCount\b|\blikes\b/i)
  })

  it('keeps the non-blocking Question participation notice', () => {
    expect(source).toContain('needsParticipationGate')
    expect(source).toContain('<QuestionIncompleteNotice />')
  })
})

// Live onboarding review, 2026-09-19: People is response-first. Identity-only
// cards created an inconsistent discovery path (some cards opened a response,
// others unexpectedly navigated to a profile). A discoverable People entry now
// requires the current visible Flagship response; profiles remain reachable as
// a deliberate secondary action from the response reader.
describe('People page — response-first discovery contract', () => {
  it('sources candidate identities from the block-aware public_profiles view', () => {
    expect(source).toContain(".from('public_profiles')")
    expect(source).toContain(".select('id, pseudonym, country, gender, gender_custom, age_range')")
    expect(source).not.toContain('getBlockedUsers')
    expect(source).not.toContain('getBlockedProfiles')
    expect(source).not.toContain('is_blocked_pair')
  })

  it('requires a visible current Flagship response before creating a People entry', () => {
    expect(source).toContain('const answer = flagshipAnswerByUserId.get(p.id)')
    expect(source).toContain('if (!answer) return false')
    expect(source).toContain('response: { id: answer.id, body: answer.body, prompt: flagshipPrompt }')
    expect(source).not.toContain('response: answer ?')
  })

  it('keeps active-correspondence and already-contacted exclusions intact', () => {
    expect(source).toContain('excludedPartnerIds.has(p.id)')
    expect(source).toContain('contactedAnswerIds.has(answer.id)')
  })

  it('does not render identity-only discovery entries', () => {
    expect(source).not.toContain('response: null')
  })

  it('uses calm People-level empty states without implying a system failure', () => {
    expect(source).not.toContain('No responses match right now.')
    expect(source).not.toContain('No answers match right now.')
    expect(source).toContain("There's no one new to discover right now.")
    expect(source).toContain('No one matches those filters right now.')
    expect(source).toContain("You've seen everyone in this pool for now.")

    const emptyStateStart = source.indexOf('{entries.length === 0 ? (')
    const emptyStateEnd = source.indexOf(') : (', emptyStateStart)
    const emptyStateBody = source.slice(emptyStateStart, emptyStateEnd).toLowerCase()
    expect(emptyStateBody).not.toContain('error')
    expect(emptyStateBody).not.toContain('try again')
    expect(emptyStateBody).not.toContain('broken')
  })
})
