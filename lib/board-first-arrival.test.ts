import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveOnboardingDestination } from './onboarding'
import { resolveAccountEntryDestination } from './account-entry'
import { ROOM_HOME, ROOM_WRITE, roomLetterPath } from './room-paths'
import { directoryUrl } from './directory-state'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'
import es from '@/messages/es.json'
import pt from '@/messages/pt.json'

const root=process.cwd()
const read=(file:string)=>readFileSync(root+'/'+file,'utf8')
const eligible={authenticated:true,pilotAccess:true,languageConfirmed:true,eligibilityStatus:'eligible' as const,
  eligibleOn:null,legalCurrent:true,hasProfile:true,onboardingStage:'complete' as const,firstArrivalPending:true}

describe('The Board — one first arrival and one canonical discovery destination',()=>{
  it('requires a durable welcome only after the adult and legal gates',()=>{
    expect(resolveAccountEntryDestination(eligible,'/home')).toBe('/welcome')
    expect(resolveAccountEntryDestination({...eligible,legalCurrent:false},'/home')).toBe('/begin')
    expect(resolveAccountEntryDestination({...eligible,languageConfirmed:false},'/home')).toBe('/language')
    expect(resolveAccountEntryDestination({...eligible,pilotAccess:false},'/home')).toBe('/welcome')
    expect(resolveAccountEntryDestination(eligible,'/welcome')).toBe('/welcome')
    expect(resolveAccountEntryDestination({...eligible,firstArrivalPending:false},'/home')).toBe('/home')
  })

  it('never forces a Mark, Question answer or writing font on complete members',()=>{
    expect(resolveOnboardingDestination({...eligible,needsWritingStyle:true},'/board')).toBe('/welcome')
    expect(resolveOnboardingDestination({...eligible,needsWritingStyle:true,firstArrivalPending:false},'/board')).toBe('/board')
  })

  it('has one Board root, a writer directory and contextual first-letter destination',()=>{
    expect(ROOM_HOME).toBe('/board')
    expect(ROOM_WRITE).toBe('/board/write')
    expect(directoryUrl({country:'Japan'})).toBe('/board/people?country=Japan')
    expect(roomLetterPath('11111111-2222-4333-8444-555555555555'))
      .toBe('/board/letters/11111111-2222-4333-8444-555555555555')
  })

  it('places People directly under Board rather than Letterbox',()=>{
    const board=read('app/board/board-tabs.tsx')
    const letters=read('app/letters/page.tsx')
    expect(board).toContain("href: '/board/people'")
    expect(board).toContain("href: '/board'")
    expect(letters).not.toContain('<LettersTabs')
  })

  it('retains old Room, Minds and Discover links without a redirect loop',()=>{
    const config=read('next.config.ts')
    for(const [old,newPath] of [
      ['/room','/board'],['/room/write','/board/write'],
      ['/minds','/board/people'],['/letters/discover','/board/people'],
    ]) {
      expect(config).toContain(`source: "${old}"`)
      expect(config).toContain(`destination: "${newPath}"`)
    }
  })

  it('includes translated arrival, Open Letters and People for four languages',()=>{
    for(const dict of [en,fr,es,pt]) {
      expect(dict.Welcome.title.length).toBeGreaterThan(10)
      expect(dict.Welcome.body.length).toBeGreaterThan(30)
      expect(dict.Board.open).toBeTruthy()
      expect(dict.Board.people).toBeTruthy()
      expect(dict.Nav.room).not.toBe('The Room')
    }
  })

  it('has a re-playable welcome and no flagship gate on ordinary Home',()=>{
    expect(read('app/you/guide/page.tsx')).toContain("href: '/you/guide/arrival'")
    expect(read('app/home/page.tsx')).not.toContain('<IntroductionReminder')
    expect(read('app/welcome/page.tsx')).toContain("rpc('complete_my_first_arrival')")
  })

  it('keeps open-access security independent of member onboarding',()=>{
    const sql=read('docs/sql/2026-10-11-board-first-arrival-REVIEW.sql')
    expect(sql).toContain('WHERE id=auth.uid()')
    expect(sql).toContain('first_arrival_seen_at')
    expect(sql).toContain('onboarding_stage')
    expect(sql).not.toContain('UPDATE auth.users')
  })
})
