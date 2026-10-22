import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FIRST_ARRIVAL_MATCH_LIMIT, loadFirstArrivalMatches, toIntroductionCards } from '@/lib/member-introductions'
import { introductionDestinations } from '@/lib/introduction-navigation'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'
import es from '@/messages/es.json'
import pt from '@/messages/pt.json'

const read = (name: string) => readFileSync(path.join(process.cwd(), name), 'utf8')
const row = (index: number) => ({
  candidate_id: `member-${index}`, pseudonym: `Writer ${index}`,
  country: 'Canada', gender: null, gender_custom: null, age_range: null, mark_id: null,
  languages: ['English'], intent: ['Thoughtful conversation'],
  shared_languages: ['English'], shared_intents: ['Thoughtful conversation'],
  answer_id: `letter-${index}`, prompt: '', body: 'The little things I noticed today.',
  source_type: 'board_letter' as const,
})

describe('First arrival — recommendation contract', () => {
  it('caps first-arrival introductions at six, without changing seven-card sign-in introductions', async () => {
    expect(FIRST_ARRIVAL_MATCH_LIMIT).toBe(6)
    const calls: Array<{ name: string; args: unknown }> = []
    const supabase = {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args })
        return name === 'get_first_arrival_auto_matches'
          ? { data: Array.from({ length: 9 }, (_, i) => row(i)), error: null }
          : { data: [], error: null }
      },
      storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    } as unknown as SupabaseClient
    const cards = await loadFirstArrivalMatches(supabase)
    expect(cards).toHaveLength(6)
    expect(calls[0]).toEqual({ name: 'get_first_arrival_auto_matches', args: { p_limit: 6 } })
    expect(cards[0]).toMatchObject({ sourceType: 'board_letter', body: 'The little things I noticed today.' })
    expect(toIntroductionCards(Array.from({ length: 9 }, (_, i) => row(i)), () => '')).toHaveLength(7)
  })

  it('fails visibly instead of pretending a failed RPC means there are no members', async () => {
    const supabase = { rpc: async () => ({ data: null, error: { message: 'Unavailable' } }) } as unknown as SupabaseClient
    await expect(loadFirstArrivalMatches(supabase)).rejects.toThrow('Could not load')
  })

  it('leaves legacy navigation unchanged, with a safe optional Board return', () => {
    expect(introductionDestinations('writer', 'letter').profileHref).toContain('returnTo=%2Fhome')
    expect(introductionDestinations('writer', 'letter', 'board_letter', '/board').writeHref)
      .toBe('/write/writer?d=letter&source=room_letter&returnTo=%2Fboard')
    expect(introductionDestinations('writer', 'letter', undefined, '/admin').writeHref)
      .toContain('returnTo=%2Fhome')
  })

  it('uses public writing, a common language and intent compatibility; never modifies the returning-member RPC', () => {
    const sql = read('docs/sql/2026-10-22-first-arrival-auto-match.sql')
    expect(sql).toContain('get_first_arrival_auto_matches')
    expect(sql).toContain('p.languages && v.languages')
    expect(sql).toContain('cardinality(c.shared_intents) desc')
    expect(sql).toContain('cardinality(c.shared_languages) desc')
    expect(sql).toContain("d.published_as='member'")
    expect(sql).toContain("d.moderation_status='visible'")
    expect(sql).toContain('public.public_profiles')
    expect(sql).toContain('public.member_introduction_history')
    expect(sql).toContain('h.user_id is null')
    expect(sql).toContain('limit least(greatest(coalesce(p_limit, 6), 1), 6)')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_first_arrival_auto_matches(integer) FROM PUBLIC, anon;')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.get_member_introductions_v2')
    expect(sql).not.toContain('UPDATE auth.users')
    expect(sql).not.toContain('FROM public.letters ')
  })

  it('preserves the old welcome and first-letter flow, with a skippable one-time match step', () => {
    const welcome = read('app/welcome/page.tsx')
    const server = read('app/welcome/people/page.tsx')
    const client = read('app/welcome/people/auto-match-arrival.tsx')
    expect(welcome).toContain("rpc('complete_my_first_arrival')")
    expect(welcome).toContain("redirect('/welcome/people')")
    for (const gate of ["if (!user) redirect('/sign-in')", "if (!profile.mark_id) redirect('/you/mark')", "if (!profile.first_arrival_seen_at) redirect('/welcome')", "if (profile.auto_match_completed_at) redirect('/board')"]) expect(server).toContain(gate)
    expect(client).toContain("setPhase('invitation')")
    expect(client).toContain("finish('/board/write')")
    expect(client).toContain("finish('/board')")
    expect(client).toContain('claimIntroductionVisit')
    expect(client).toContain('onLeave={completeArrival}')
    expect(read('app/app-shell.tsx')).toContain('<MemberIntroductions />')
  })

  it('has coherent four-locale onboarding language and six-person card progress', () => {
    for (const dict of [en,fr,es,pt]) {
      expect(dict.Welcome.button.length).toBeGreaterThan(8)
      expect(dict.MemberIntroductions.autoMatchProgress).toContain('{current}')
      expect(dict.MemberIntroductions.autoMatchProgress).toContain('{total}')
      expect(dict.AutoMatch.interestsHeading.length).toBeGreaterThan(5)
      expect(dict.AutoMatch.inviteBody.length).toBeGreaterThan(25)
      expect(Object.keys(dict.AutoMatch.interests)).toHaveLength(10)
    }
  })
})
