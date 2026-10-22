import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
const file=(p:string)=>readFileSync(path.join(process.cwd(),p),'utf8')
describe('Guided Board letter launch and durability contract',()=>{
  it('requires auth and a Mark without changing publishing or safety',()=>{
    const page=file('app/board/write/guided/page.tsx')
    expect(page).toContain("redirect('/sign-in')")
    expect(page).toContain("redirect('/you/mark')")
    expect(file('app/board/write/page.tsx')).toContain('<DispatchComposer')
    expect(file('app/board/dispatch-composer.tsx')).toContain('evaluateSafety')
  })
  it('never overwrites a saved draft, and uses canonical Board draft persistence',()=>{
    const s=file('app/board/write/guided/guided-letter-journey.tsx')
    expect(s).toContain('readDispatchDraft(userId)')
    expect(s).toContain('writeDispatchDraft(userId, assembled)')
    expect(s).toContain("router.push('/board/write')")
    expect(s).toContain('Nothing is published until')
  })
  it('preserves first-arrival skip and private correspondence actions',()=>{
    const s=file('app/welcome/people/auto-match-arrival.tsx')
    expect(s).toContain("finish('/board/write/guided')")
    expect(s).toContain("finish('/board/write')")
    expect(s).toContain("finish('/board')")
    expect(s).toContain('onLeave={completeArrival}')
  })
})
