/**
 * Local-only first-letter assistance. An author owns every word, no AI call,
 * no publication, and no server recording of prompts or drafts.
 */
export const WRITING_STARTERS = [
  { id: 'ordinary-day', title: 'An ordinary day', opening: 'Something small happened recently that I keep thinking about…',
    prompts: ['What happened?', 'Why did it stay with you?', 'What would you like someone else to tell you about?'],
    suggestedTitle: 'A small moment from my day' },
  { id: 'someone-i-remember', title: 'Someone I remember', opening: 'There’s someone I remember more often than they probably realize…',
    prompts: ['Who comes to mind? You can leave out their name.', 'What small detail about them do you remember?', 'Does this remind you of someone in your life, too?'],
    suggestedTitle: 'Someone I still remember' },
  { id: 'a-place', title: 'A place I carry with me', opening: 'There’s a place I haven’t been to in years, but I still remember…',
    prompts: ['Which place are you thinking of?', 'What detail makes it feel vivid to you?', 'Is there a place you still carry with you?'],
    suggestedTitle: 'A place I carry with me' },
  { id: 'something-i-wonder', title: 'Something I’ve been wondering', opening: 'I wonder whether other people ever feel this way…',
    prompts: ['What have you been wondering about lately?', 'What made you start thinking about it?', 'What would you like someone else’s perspective on?'],
    suggestedTitle: 'Something I’ve been wondering' },
] as const

export type StarterId = (typeof WRITING_STARTERS)[number]['id']
export type GuidedAnswers = readonly [string, string, string]
export type GuidedLetterDraft = { title: string; paragraphs: string[]; body: string }

export function assembleGuidedLetter(starterId: StarterId, answers: GuidedAnswers): GuidedLetterDraft {
  const starter = WRITING_STARTERS.find(entry => entry.id === starterId)
  if (!starter) throw new Error('Unknown writing starter')
  const paragraphs = answers.map(value => value.trim()).filter(Boolean)
  return { title: starter.suggestedTitle, paragraphs, body: paragraphs.join('\n\n') }
}
export function canContinueGuidedWriting(answers: readonly string[]): boolean {
  return answers.some(answer => answer.trim().length >= 20)
}
export function guidedDraftDocument(paragraphs: readonly string[]) {
  return { type: 'doc' as const, content: paragraphs.map(value => ({
    type: 'paragraph' as const, content: [{ type: 'text' as const, text: value }],
  })) }
}
export const PERSONAL_INTRODUCTION_PROMPTS = [
  'What brings you to Tempa?',
  'What is something you enjoy talking or writing about?',
] as const
export function assemblePersonalIntroduction(answers: readonly string[]): string {
  return answers.map(answer => answer.trim()).filter(Boolean).join('\n\n')
}
