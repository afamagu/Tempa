import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Onboarding & First-Use checkpoint — People Information Architecture
// (Section E/F). Async Server Component with heavy Supabase dependency,
// same "not directly unit-tested" convention as every other page like
// this in this codebase.
const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('People page (formerly Minds) — discovery-only, response management relocated', () => {
  it('the visible heading is "People", never "Minds"', () => {
    expect(source).toContain('>People</h1>')
    expect(source).not.toMatch(/>Minds<\/h1>/)
  })

  it('no longer presents My answers / Answer a Question as co-equal tabs alongside Explore — MindsTabs/QuestionWorkspace are gone from this file', () => {
    expect(source).not.toContain('MindsTabs')
    expect(source).not.toContain('QuestionWorkspace')
    expect(source).not.toContain("view === 'answers'")
    expect(source).not.toContain("view === 'answer'")
    expect(source).not.toContain('My answers')
  })

  it('response management now lives at /you/responses, never at /minds?view=', () => {
    expect(source).not.toContain('/minds?view=')
  })

  it('shows the People FeatureIntroduction once, gated on the account-persisted guide_completions state, never unconditionally', () => {
    expect(source).toContain("import { hasCompletedGuide } from '@/lib/guide'")
    expect(source).toContain("hasCompletedGuide(supabase, user.id, 'people')")
    expect(source).toContain('{!introSeen && (')
    expect(source).toContain('<FeatureIntroduction guideKey="people"')
  })

  it('the FeatureIntroduction uses the approved copy direction', () => {
    expect(source).toContain('People worth writing to')
    expect(source).toContain('Start exploring')
    expect(source).toContain('Tempa isn')
  })

  it('preserves every existing discovery/eligibility rule unchanged — same exclusions, same pagination', () => {
    expect(source).toContain('getActiveCorrespondencePartnerIds')
    expect(source).toContain('getContactedAnswerIds')
    expect(source).toContain("moderation_status', 'visible'")
    expect(source).toContain('BATCH_SIZE')
    expect(source).toContain('stableShuffle')
  })

  it('never introduces popularity ranking or swipe mechanics', () => {
    const lower = source.toLowerCase()
    expect(lower).not.toContain('popularity')
    expect(lower).not.toContain('swipe')
  })

  it('never introduces an actual followers/likes FEATURE — the approved copy legitimately says "isn\'t about collecting followers" once, as a contrast, never a Follow button/count', () => {
    expect(source).not.toMatch(/\bFollow\b/)
    expect(source).not.toContain('followerCount')
    expect(source).not.toMatch(/\blikeCount\b|\blikes\b/i)
    expect((source.match(/follower/gi) ?? []).length).toBe(1)
  })

  it('the non-blocking Question nudge still routes to the new /you/responses location', () => {
    expect(source).toContain('needsParticipationGate')
    expect(source).toContain('<QuestionIncompleteNotice />')
  })

  it('uses "responses," not "answers," in the empty-state copy', () => {
    expect(source).toContain('No responses match right now.')
    expect(source).not.toContain('No answers match right now.')
  })
})
