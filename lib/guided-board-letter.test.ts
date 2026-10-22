import { describe, expect, it } from 'vitest'
import { assembleGuidedDraft, newGuidedProgress, normalizeGuidedProgress, GUIDED_THEMES, guidedDraftStorageKey } from './guided-board-letter'
import { docToPlainBody } from './letter-editor-doc'

describe('Guided Board letters',()=>{
  it('offers four inviting themes with three concrete questions',()=>{
    expect(GUIDED_THEMES).toHaveLength(4)
    expect(new Set(GUIDED_THEMES.map(x=>x.id)).size).toBe(4)
    for(const theme of GUIDED_THEMES)expect(theme.questions).toHaveLength(3)
  })
  it('assembles only words supplied by the writer and retains paragraphs',()=>{
    const input = {theme:'ordinary-day' as const,step:3,answers:['Something happened.','I thought about it.','Tell me about your day.'] as [string,string,string]}
    const draft=assembleGuidedDraft(input)!
    expect(draft.title).toBe('Something from an ordinary day')
    expect(draft.topics).toEqual([])
    expect(docToPlainBody(draft.doc)).toContain('Something happened.\n\nI thought about it.\n\nTell me about your day.')
  })
  it('cannot produce a letter if all answers are empty',()=>{
    expect(assembleGuidedDraft({theme:'other',step:3,answers:['','  ','']})).toBeNull()
    expect(assembleGuidedDraft(newGuidedProgress())).toBeNull()
  })
  it('resumes safely and rejects corrupted theme/overlong input',()=>{
    expect(normalizeGuidedProgress({theme:'fake',step:999,answers:['x'.repeat(3000)]})).toMatchObject({theme:null,step:3,answers:['x'.repeat(1500),'','']})
    expect(guidedDraftStorageKey('user-1')).not.toBe(guidedDraftStorageKey('user-2'))
  })
})
