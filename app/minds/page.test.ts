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

  it('the empty state no longer talks about "responses" not matching — see the people-first contract describe block below', () => {
    expect(source).not.toContain('No responses match right now.')
    expect(source).not.toContain('No answers match right now.')
  })
})

// Post-onboarding corrections checkpoint (Section A/B/C) — a real smoke
// test found that a brand-new member saw exactly one person (whoever
// happened to have answered the current Flagship Question) and, once
// that person became an active correspondence partner, People went
// completely empty. Root cause: the pool was sourced exclusively from
// question_answers, so having no Flagship response made a PERSON
// disappear entirely. These tests pin the corrected, people-first
// contract at the source level (same "not directly unit-tested Server
// Component, proven via source inspection" convention as the rest of
// this file).
describe('People page — people-first discovery contract (Post-onboarding corrections checkpoint)', () => {
  it('the eligible pool is sourced from public_profiles directly, never exclusively from question_answers', () => {
    expect(source).toContain(".from('public_profiles')")
    expect(source).toContain(".select('id, pseudonym, country, gender, gender_custom, age_range')")
    // The population query itself carries no dependency on having
    // answered anything — .eq('question_id', ...) only ever appears on
    // the SEPARATE, optional Flagship-answer lookup used for previews.
    const profilesQueryStart = source.indexOf(".from('public_profiles')")
    const profilesQueryEnd = source.indexOf(',', source.indexOf(".neq('id', user.id)", profilesQueryStart))
    expect(source.slice(profilesQueryStart, profilesQueryEnd)).not.toContain('question_id')
  })

  it('a person with no Flagship answer is never excluded from the pool merely for that reason', () => {
    // eligibleProfiles is built by filtering profiles — correspondence
    // and already-contacted exclusions only, never an existence check
    // on flagshipAnswerByUserId.
    expect(source).toContain('const eligibleProfiles = (profiles ?? []).filter((p) => {')
    const guardStart = source.indexOf('const eligibleProfiles = (profiles ?? []).filter((p) => {')
    const guardEnd = source.indexOf('})', guardStart)
    const guardBody = source.slice(guardStart, guardEnd)
    expect(guardBody).toContain('excludedPartnerIds.has(p.id)')
    expect(guardBody).not.toMatch(/!answer\b/)
    expect(guardBody).not.toContain('!flagshipAnswerByUserId.has')
  })

  it('DiscoveryEntry.response is optional — a card can render identity-only, with the response merged in afterward', () => {
    expect(source).toContain('response: answer ? { id: answer.id, body: answer.body, prompt: flagshipPrompt } : null')
  })

  it('full blocking is relied on via the already block-aware public_profiles view, never a second client-side block filter', () => {
    expect(source).toContain('public_profiles')
    expect(source).not.toContain('getBlockedUsers')
    expect(source).not.toContain('getBlockedProfiles')
    expect(source).not.toContain('is_blocked_pair')
  })

  it('People-level empty states never claim "responses" did not match — three distinct, calm outcomes instead', () => {
    expect(source).not.toContain('No responses match right now.')
    expect(source).toContain("There's no one new to discover right now.")
    expect(source).toContain('No one matches those filters right now.')
    expect(source).toContain("You've seen everyone in this pool for now.")
  })

  it('never implies the platform is broken — no "error"/"try again" language in the empty state', () => {
    const emptyStateStart = source.indexOf('{entries.length === 0 ? (')
    const emptyStateEnd = source.indexOf(') : (', emptyStateStart)
    const emptyStateBody = source.slice(emptyStateStart, emptyStateEnd).toLowerCase()
    expect(emptyStateBody).not.toContain('error')
    expect(emptyStateBody).not.toContain('try again')
    expect(emptyStateBody).not.toContain('broken')
  })
})
