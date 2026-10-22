import { plainBodyToLetterDoc } from './letter-editor-doc'
import type { DispatchDraft } from './letter-editor-draft'

/** Public, editorial prompts only. Nothing is generated about the member. */
export const GUIDED_THEMES = [
  {
    id: 'ordinary-day',
    label: 'An ordinary day',
    beginning: 'Something small happened recently that I keep thinking about…',
    title: 'Something from an ordinary day',
    questions: ['What happened?', 'Why did it stay with you?', 'What would you like someone else to tell you about?'],
  },
  {
    id: 'someone',
    label: 'Someone I remember',
    beginning: 'There’s someone I remember more often than they probably realize…',
    title: 'Someone I remember',
    questions: ['Who came to mind?', 'What is a small detail you remember about them?', 'What would you ask someone who knows a person like that?'],
  },
  {
    id: 'place',
    label: 'A place I carry with me',
    beginning: 'There’s a place I haven’t been to in years, but I still remember…',
    title: 'A place I remember',
    questions: ['Where does your mind wander back to?', 'What detail about that place has stayed with you?', 'What place would you like someone else to tell you about?'],
  },
  {
    id: 'thought',
    label: 'Something I’ve been wondering',
    beginning: 'I wonder whether other people ever feel this way…',
    title: 'Something I’ve been wondering',
    questions: ['What have you been wondering about?', 'What made you think of it?', 'What would you like to hear from someone else?'],
  },
] as const

export type GuidedThemeId = typeof GUIDED_THEMES[number]['id'] | 'other'
export type GuidedProgress = { theme: GuidedThemeId | null; step: number; answers: [string, string, string] }

export function newGuidedProgress(): GuidedProgress {
  return { theme: null, step: 0, answers: ['', '', ''] }
}

export function guidedDraftStorageKey(userId: string): string {
  return `tempa-guided-letter:${userId}`
}

export function normalizeGuidedProgress(value: unknown): GuidedProgress {
  const empty = newGuidedProgress()
  if (!value || typeof value !== 'object') return empty
  const row = value as Record<string, unknown>
  const theme = row.theme === 'other' || GUIDED_THEMES.some(t => t.id === row.theme)
    ? row.theme as GuidedThemeId : null
  const answers: [string, string, string] = ['', '', '']
  if (Array.isArray(row.answers)) {
    for (let i = 0; i < 3; i++) {
      if (typeof row.answers[i] === 'string') answers[i] = row.answers[i].slice(0, 1500)
    }
  }
  return { theme, step: typeof row.step === 'number' && Number.isInteger(row.step) ? Math.max(0, Math.min(3, row.step)) : 0, answers }
}

export function assembleGuidedDraft(progress: GuidedProgress): DispatchDraft | null {
  if (!progress.theme) return null
  const paragraphs = progress.answers.map(answer => answer.trim()).filter(Boolean)
  if (paragraphs.length === 0) return null
  const chosen = GUIDED_THEMES.find(t => t.id === progress.theme)
  const title = chosen?.title ?? 'A little about my life'
  return { title, topics: [], doc: plainBodyToLetterDoc(paragraphs.join('\n\n')) }
}
