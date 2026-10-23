/** Import an explicitly approved guided draft into the existing native Board draft.
 * Never overwrite another draft, including Moments and title-only drafts. */
import { type LetterDocJSON, letterDocHasContent } from './letter-editor-doc'
import { readDispatchDraft, writeDispatchDraft } from './letter-editor-draft'
import { type GuidedLetterDraft } from './guided-open-letter'
export type HandoffResult = 'saved'|'existing-draft'|'empty'|'save-failed'

export function guidedDraftToEditorDoc(paragraphs:readonly string[]):LetterDocJSON {
  const nodes=paragraphs.flatMap(paragraph=>{
    const value=paragraph.trim()
    if(!value)return []
    const lines=value.split(/\r?\n/)
    return [{type:'paragraph' as const,content:lines.flatMap((line,index)=>
      index===0 ? [{type:'text' as const,text:line}] : [{type:'hardBreak' as const},{type:'text' as const,text:line}]
    )}]
  })
  return {type:'doc',content:nodes.length?nodes:[{type:'paragraph'}]}
}
export function sendGuidedDraftToBoard(authorId:string,draft:GuidedLetterDraft):HandoffResult {
  if(!authorId)return 'save-failed'
  const current=readDispatchDraft(authorId)
  if(current&&(current.title.trim()||current.topics.length||letterDocHasContent(current.doc)))return 'existing-draft'
  const doc=guidedDraftToEditorDoc(draft.paragraphs)
  if(!letterDocHasContent(doc))return 'empty'
  return writeDispatchDraft(authorId,{title:draft.title,doc,topics:[]})?'saved':'save-failed'
}
