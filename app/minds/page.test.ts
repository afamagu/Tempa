import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
// Candidate selection moved into one bounded Postgres RPC
// (public.discover_people) behind lib/discovery.ts.
const sql = readFileSync(path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-13-prelaunch-performance.sql'), 'utf8').replace(/\r\n/g, '\n')
const discoverFn = sql.slice(sql.indexOf('create or replace function public.discover_people('), sql.indexOf('$function$;', sql.indexOf('create or replace function public.discover_people(')))

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

  it('preserves correspondence, moderation, pagination and stable-order boundaries (in the discovery RPC)', () => {
    expect(source).toContain('getDiscoveryPage(supabase, { country, gender, ageRange: age, offset: batch * BATCH_SIZE, limit: BATCH_SIZE })')
    expect(discoverFn).toContain("c.status = 'active'")
    expect(discoverFn).toContain('from public.letters_for_participant l')
    expect(discoverFn).toContain("qa.moderation_status = 'visible'")
    expect(discoverFn).toContain("hashtext(v.id::text || ':' || p.id::text) as sort_key")
    expect(discoverFn).toContain('order by f.sort_key, f.user_id')
    expect(discoverFn).not.toMatch(/random\(\)/)
  })

  it('never loads the member population into the page', () => {
    expect(source).not.toContain(".from('public_profiles')")
    expect(source).not.toContain(".from('question_answers')")
    expect(source).not.toContain('answersByUserId')
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
  it('sources candidate identities from the block-aware public_profiles view, answers under question_answers RLS', () => {
    expect(discoverFn).toContain('from public.public_profiles p')
    expect(discoverFn).toContain('join visible_profiles p on p.id = r.user_id')
    expect(discoverFn).toContain('from public.question_answers qa')
    expect(discoverFn).toContain('security invoker')
    expect(source).not.toContain('getBlockedUsers')
    expect(source).not.toContain('getBlockedProfiles')
    expect(discoverFn).not.toContain('is_blocked_pair')
  })

  it('requires a visible representative response without requiring the current Flagship specifically', () => {
    expect(discoverFn).toContain('select distinct on (qa.user_id)')
    expect(discoverFn).toContain('(qa.question_id = (select f.id from flagship f)) desc nulls last,\n      qa.is_current desc nulls last,\n      qa.updated_at desc nulls last')
    expect(source).toContain('prompt: candidate.prompt')
    expect(source).not.toContain('response: answer ?')
  })

  it('keeps active-correspondence and already-contacted exclusions intact', () => {
    expect(discoverFn).toContain('not exists (select 1 from partners x where x.user_id = r.user_id)')
    expect(discoverFn).toContain('not exists (select 1 from contacted c where c.answer_id = r.id)')
    expect(discoverFn).toContain("l.reply_to_id is null")
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
    expect(source).toContain("publicProfileMarkUrl(supabase, `${candidate.markId}.png`)")
    expect(source).toContain(': null')
  })
})
