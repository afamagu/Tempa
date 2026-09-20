import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chooseDiscoveryAnswer } from './page'

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

// People remains response-first: every card opens writing. The representative
// response prefers today's Flagship, but a Flagship rotation must not erase an
// established member who has other legitimate visible writing.
describe('People page — response-first discovery contract', () => {
  it('sources candidate identities from the block-aware public_profiles view', () => {
    expect(source).toContain(".from('public_profiles')")
    expect(source).toContain(".select('id, pseudonym, country, gender, gender_custom, age_range, mark_id')")
    expect(source).not.toContain('getBlockedUsers')
    expect(source).not.toContain('getBlockedProfiles')
    expect(source).not.toContain('is_blocked_pair')
  })

  it('requires a visible representative response without requiring the current Flagship specifically', () => {
    expect(source).toContain('const answer = discoveryAnswerByUserId.get(profile.id)')
    expect(source).toContain('if (!answer) return false')
    expect(source).toContain('prompt: promptsById.get(answer.question_id)')
    expect(source).not.toContain('response: answer ?')
  })

  it('keeps active-correspondence and already-contacted exclusions intact', () => {
    expect(source).toContain('excludedPartnerIds.has(profile.id)')
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

  it('resolves saved Marks from opaque mark_id values and leaves null for legacy profiles', () => {
    expect(source).toContain("publicProfileMarkUrl(supabase, `${profile.mark_id}.png`)")
    expect(source).toContain(': null')
  })
})

describe('chooseDiscoveryAnswer — established-member continuity', () => {
  const answer = (overrides: Partial<Parameters<typeof chooseDiscoveryAnswer>[0][number]> = {}) => ({
    id: 'answer-1',
    user_id: 'user-1',
    question_id: 'old-question',
    body: 'An established response',
    updated_at: '2026-09-01T00:00:00Z',
    is_current: false,
    ...overrides,
  })

  it('prefers the current Flagship response when one exists', () => {
    const legacy = answer({ id: 'legacy', is_current: true })
    const flagship = answer({ id: 'flagship', question_id: 'current-flagship' })
    expect(chooseDiscoveryAnswer([legacy, flagship], 'current-flagship')?.id).toBe('flagship')
  })

  it('falls back to an established member\'s current response when they have not answered the new Flagship', () => {
    const current = answer({ id: 'legacy-current', is_current: true })
    expect(chooseDiscoveryAnswer([current], 'new-flagship')?.id).toBe('legacy-current')
  })

  it('falls back deterministically to the latest visible response for historical rows without is_current', () => {
    const older = answer({ id: 'older', updated_at: '2026-08-01T00:00:00Z' })
    const newer = answer({ id: 'newer', updated_at: '2026-09-01T00:00:00Z' })
    expect(chooseDiscoveryAnswer([older, newer], 'new-flagship')?.id).toBe('newer')
  })

  it('still excludes profiles with no visible response', () => {
    expect(chooseDiscoveryAnswer([], 'current-flagship')).toBeNull()
  })
})
