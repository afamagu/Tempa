/** Four gentle writing starters; no AI services or generated personal claims. */
export const WRITING_STARTERS = [
  { id:'ordinary-day', title:'An ordinary day', opening:'Something small happened recently that I keep thinking about…', suggestedTitle:'A small moment from my day',
    prompts:['What happened?','Why did it stay with you?','What would you like someone else to tell you about?'] },
  { id:'someone-i-remember', title:'Someone I remember', opening:'There’s someone I remember more often than they probably realize…', suggestedTitle:'Someone I still remember',
    prompts:['Who comes to mind? You can leave out their name.','What small thing about them do you still remember?','Does this remind you of someone in your life, too?'] },
  { id:'a-place', title:'A place I carry with me', opening:'There’s a place I haven’t been to in years, but I still remember…', suggestedTitle:'A place I carry with me',
    prompts:['Which place are you thinking of?','What detail makes it feel vivid to you?','Is there a place you still carry with you?'] },
  { id:'something-i-wonder', title:'Something I’ve been wondering', opening:'I wonder whether other people ever feel this way…', suggestedTitle:'Something I’ve been wondering',
    prompts:['What have you been wondering about lately?','What made you start thinking about it?','What would you like someone else’s perspective on?'] },
] as const

export type StarterId = (typeof WRITING_STARTERS)[number]['id']
export type GuidedAnswers = readonly [string,string,string]
export type GuidedLetterDraft = { title:string; paragraphs:string[]; body:string }
export function assembleGuidedLetter(starterId:StarterId, answers:GuidedAnswers, localizedTitle?:string):GuidedLetterDraft {
  const starter=WRITING_STARTERS.find(s=>s.id===starterId)
  if(!starter) throw new Error('Unknown writing starter')
  const paragraphs=answers.map(s=>s.trim()).filter(Boolean)
  return {title:localizedTitle||starter.suggestedTitle,paragraphs,body:paragraphs.join('\n\n')}
}
export function canContinueGuidedWriting(answers:readonly string[]):boolean {
  return answers.some(answer=>answer.trim().length>=20)
}
export const PERSONAL_INTRODUCTION_PROMPTS=['What brings you to Tempa?','What is something you enjoy talking or writing about?'] as const
export function assemblePersonalIntroduction(answers:readonly string[]):string {
  return answers.map(a=>a.trim()).filter(Boolean).join('\n\n')
}
