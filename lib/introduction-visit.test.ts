import { describe, expect, it } from 'vitest'
import { claimIntroductionVisit, noteIntroductionActivity, noteIntroductionAway, INTRODUCTION_RETURN_AFTER_MS as away } from './introduction-visit'
function store() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}
describe('Introduction visit timing', () => {
  it('claims once, survives remount/refresh and resets only for a new auth session', () => {
    const storage = store()
    expect(claimIntroductionVisit(storage,'session-a',1000)).toBe('initial')
    expect(claimIntroductionVisit(storage,'session-a',2000)).toBeNull()
    expect(claimIntroductionVisit(storage,'session-b',2000)).toBe('initial')
  })
  it('requires twenty minutes away and reserves a returned visit once', () => {
    const storage = store()
    claimIntroductionVisit(storage,'s',1000)
    noteIntroductionAway(storage,'s',2000)
    expect(claimIntroductionVisit(storage,'s',2000+away-1)).toBeNull()
    expect(claimIntroductionVisit(storage,'s',2000+away)).toBe('return')
    expect(claimIntroductionVisit(storage,'s',2000+away+1)).toBeNull()
  })
  it('preserves a pending long return while on another menu until Home can present it', () => {
    const storage = store()
    claimIntroductionVisit(storage,'s',1000); noteIntroductionAway(storage,'s',2000)
    noteIntroductionActivity(storage,'s',2000+away)
    noteIntroductionActivity(storage,'s',3000+away)
    expect(claimIntroductionVisit(storage,'s',4000+away)).toBe('return')
  })
  it('regular activity across menus suppresses false idle returns', () => {
    const storage = store()
    claimIntroductionVisit(storage,'s',1000)
    for (let time=60000;time<3*away;time+=60000) noteIntroductionActivity(storage,'s',time)
    expect(claimIntroductionVisit(storage,'s',3*away)).toBeNull()
  })
  it('detects a long gap on reload even when pagehide was not delivered', () => {
    const storage = store()
    claimIntroductionVisit(storage,'s',1000)
    expect(claimIntroductionVisit(storage,'s',1000+away)).toBe('return')
  })
  it('blocked storage still suppresses repeated menu mounts in memory', () => {
    const storage = { getItem: () => { throw Error('denied') }, setItem: () => { throw Error('denied') } }
    expect(claimIntroductionVisit(storage,'blocked',1000)).toBe('initial')
    expect(claimIntroductionVisit(storage,'blocked',2000)).toBeNull()
  })
})
