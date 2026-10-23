import { describe,it,expect,vi,beforeEach } from 'vitest'
import { WRITING_STARTERS,assembleGuidedLetter,canContinueGuidedWriting } from '@/lib/guided-open-letter'
import { guidedDraftToEditorDoc,sendGuidedDraftToBoard } from '@/lib/guided-letter-handoff'
vi.mock('@/lib/letter-editor-draft',()=>({readDispatchDraft:vi.fn(),writeDispatchDraft:vi.fn(()=>true)}))
import { readDispatchDraft,writeDispatchDraft } from '@/lib/letter-editor-draft'
const read=vi.mocked(readDispatchDraft),write=vi.mocked(writeDispatchDraft)
beforeEach(()=>{vi.resetAllMocks();read.mockReturnValue(null);write.mockReturnValue(true)})
describe('Guided first Board letter',()=>{
 it('has four themes of exactly three questions',()=>{
   expect(WRITING_STARTERS).toHaveLength(4)
   WRITING_STARTERS.forEach(s=>expect(s.prompts).toHaveLength(3))
 })
 it('only uses a member’s own words, preserving the order of non-empty answers',()=>{
   expect(assembleGuidedLetter('ordinary-day',['  I met someone at a bus stop.  ','','  Has that happened to you?  ']).body)
   .toBe('I met someone at a bus stop.\n\nHas that happened to you?')
 })
 it('accepts one meaningful answer and no required third-person disclosures',()=>{
   expect(canContinueGuidedWriting(['A moment that stayed with me.','',''])).toBe(true)
   expect(canContinueGuidedWriting(['Brief','',''])).toBe(false)
 })
 it('preserves line breaks for the existing editor',()=>{
  expect(guidedDraftToEditorDoc(['hello\nworld']).content).toEqual([{type:'paragraph',content:[{type:'text',text:'hello'},{type:'hardBreak'},{type:'text',text:'world'}]}])
 })
 it('never overwrites an existing Board draft',()=>{
  read.mockReturnValue({title:'Existing',topics:[],doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Real draft'}]}]}})
  expect(sendGuidedDraftToBoard('user',assembleGuidedLetter('ordinary-day',['An ordinary moment that stayed with me.','','']))).toBe('existing-draft')
  expect(write).not.toHaveBeenCalled()
 })
 it('imports to native draft storage, and reports failed persistence',()=>{
  const letter=assembleGuidedLetter('ordinary-day',['An ordinary moment that stayed with me.','',''])
  expect(sendGuidedDraftToBoard('user',letter)).toBe('saved')
  expect(write).toHaveBeenCalledWith('user',expect.objectContaining({title:letter.title,topics:[],doc:expect.objectContaining({type:'doc'})}))
  write.mockReturnValue(false)
  expect(sendGuidedDraftToBoard('user',letter)).toBe('save-failed')
 })
})
