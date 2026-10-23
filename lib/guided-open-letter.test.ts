import { describe, expect, it } from 'vitest'
import { WRITING_STARTERS, assembleGuidedLetter, canContinueGuidedWriting, guidedDraftDocument, assemblePersonalIntroduction } from './guided-open-letter'
describe('guided first open letter', () => {
  it('offers four writing paths with three prompts each', () => {
    expect(WRITING_STARTERS).toHaveLength(4)
    expect(new Set(WRITING_STARTERS.map(s=>s.id)).size).toBe(4)
    expect(WRITING_STARTERS.every(s=>s.prompts.length===3)).toBe(true)
  })
  it('never fabricates content, and never forces all prompts', () => {
    const d=assembleGuidedLetter('ordinary-day',['An ordinary bus ride stayed with me.','','Does anyone else notice small details?'])
    expect(d.body).toBe('An ordinary bus ride stayed with me.\n\nDoes anyone else notice small details?')
    expect(d.paragraphs).toHaveLength(2)
    expect(guidedDraftDocument(d.paragraphs)).toEqual({type:'doc',content:[
      {type:'paragraph',content:[{type:'text',text:'An ordinary bus ride stayed with me.'}]},
      {type:'paragraph',content:[{type:'text',text:'Does anyone else notice small details?'}]},
    ]})
    expect(canContinueGuidedWriting(['','',''])).toBe(false)
    expect(canContinueGuidedWriting(['One worthwhile thought is enough.','',''])).toBe(true)
  })
  it('preserves optional personal-introduction author text', () => {
    expect(assemblePersonalIntroduction(['  To meet a correspondent. ','  I enjoy gardens.']))
      .toBe('To meet a correspondent.\n\nI enjoy gardens.')
  })
})
