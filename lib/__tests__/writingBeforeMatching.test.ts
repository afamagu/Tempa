import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
const file=(p:string)=>readFileSync(path.join(process.cwd(),p),'utf8')
describe('Writing before introductions — end-to-end navigation contract',()=>{
  it('grandfathers historical profiles and versions only new profiles into writing-first',()=>{
    const sql=file('docs/sql/2026-10-23-writing-before-matching.sql')
    expect(sql).toContain('UPDATE public.profiles SET first_arrival_journey_version=1')
    expect(sql).toContain('SET DEFAULT 2')
    expect(sql).toContain('first_letter_invitation_done_at')
    expect(sql).toContain('GRANT UPDATE (first_letter_invitation_done_at)')
    expect(sql).not.toContain('GRANT UPDATE ON TABLE')
  })
  it('places writing ahead of Auto-Match, regardless of skipping or publishing',()=>{
    const welcome=file('app/welcome/page.tsx')
    const letter=file('app/welcome/letter/page.tsx')
    const people=file('app/welcome/people/page.tsx')
    expect(welcome).toContain("profile.first_arrival_journey_version === 2 ? '/welcome/letter' : '/welcome/people'")
    expect(letter).toContain('href="/board/guided?firstArrival=1"')
    expect(letter).toContain('href="/board/write?firstArrival=1"')
    expect(letter).toContain('action={proceedToIntroductions}')
    expect(letter).toContain("redirect('/welcome/people')")
    expect(letter).toContain("if (published?.length)")
    expect(people).toContain("redirect('/welcome/letter')")
  })
  it('successfully publishing enters matching, without changing existing Board publisher paths',()=>{
    const page=file('app/board/write/page.tsx')
    const composer=file('app/board/dispatch-composer.tsx')
    const guide=file('app/board/guided-first-letter.tsx')
    expect(page).toContain('afterFirstArrival={')
    expect(composer).toContain("afterFirstArrival && !isEdit && !official ? '/welcome/letter?published=1'")
    expect(composer).toContain("afterFirstArrival ? '/welcome/letter' : '/room'")
    expect(guide).toContain("firstArrival ? '/board/write?firstArrival=1' : '/board/write'")
    expect(guide).toContain("router.push('/welcome/letter')")
  })
  it('does not reprompt for an open letter after writing-first matching',()=>{
    const introduction=file('app/welcome/people/auto-match-arrival.tsx')
    expect(introduction).toContain("phase === 'invitation' && !writingFirst")
    expect(introduction).toContain("phase === 'invitation' && writingFirst")
    expect(introduction).toContain("t('afterMatchBody')")
  })
})
