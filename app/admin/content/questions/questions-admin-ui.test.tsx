import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CurrentQuestionSlot from './current-question-slot'
import QuestionRow from './question-row'
import type { AdminQuestion } from '@/lib/admin-questions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

function question(overrides: Partial<AdminQuestion> = {}): AdminQuestion {
  return {
    id: 'q-1',
    slug: null,
    family: null,
    prompt: 'A current prompt',
    isActive: true,
    currentPosition: 1,
    isFlagship: false,
    answerCount: 0,
    firstLetterCount: 0,
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

// Flagship Simplification correction, item 16 — the main Admin screen
// shows only THREE operational slots, each with exactly one "Edit
// Question" (or "Add Question" when empty) action and one Flagship
// radio. No Activate/Deactivate, no "Set as #N"/"Unpin," no replace-
// with-checkboxes form anywhere on this surface.
describe('CurrentQuestionSlot — the entire operational surface for one current slot (item 16)', () => {
  it('a filled slot shows its prompt, one "Edit Question" action, and a Flagship radio', () => {
    const html = renderToStaticMarkup(<CurrentQuestionSlot position={1} question={question({ prompt: 'The current prompt' })} />)
    expect(html).toContain('The current prompt')
    expect(html).toContain('Edit Question')
    expect(html).toContain('type="radio"')
    expect(html).not.toContain('Deactivate')
    expect(html).not.toContain('Activate')
    expect(html).not.toContain('Set as #')
    expect(html).not.toContain('Unpin')
    expect(html).not.toContain('Replace')
  })

  it('an empty slot shows "No Question set" and an "Add Question" action instead', () => {
    const html = renderToStaticMarkup(<CurrentQuestionSlot position={2} question={null} />)
    expect(html).toContain('No Question set')
    expect(html).toContain('Add Question')
    expect(html).not.toContain('Edit Question')
  })

  it('the Flagship radio is checked for the Flagship Question, unchecked otherwise', () => {
    const flagshipHtml = renderToStaticMarkup(<CurrentQuestionSlot position={1} question={question({ isFlagship: true })} />)
    expect(flagshipHtml).toMatch(/type="radio"[^>]*checked/)

    const notFlagshipHtml = renderToStaticMarkup(<CurrentQuestionSlot position={2} question={question({ isFlagship: false })} />)
    expect(notFlagshipHtml).not.toMatch(/type="radio"[^>]*checked/)
  })

  it('all three slots share one radio group name, so exactly one can ever be selected at a time', () => {
    const html1 = renderToStaticMarkup(<CurrentQuestionSlot position={1} question={question({ id: 'q-1' })} />)
    const html2 = renderToStaticMarkup(<CurrentQuestionSlot position={2} question={question({ id: 'q-2' })} />)
    const html3 = renderToStaticMarkup(<CurrentQuestionSlot position={3} question={question({ id: 'q-3' })} />)
    expect(html1).toContain('name="current-question-flagship"')
    expect(html2).toContain('name="current-question-flagship"')
    expect(html3).toContain('name="current-question-flagship"')
  })
})

// Flagship Simplification correction, item 17 — history is secondary
// and read-only, never mixed into the current-question controls: a
// historical row has no Edit/Replace/Activate/Position button at all.
describe('QuestionRow (historical) — read-only, no operational controls (item 17)', () => {
  it('renders the prompt and metadata, but no action buttons whatsoever', () => {
    const html = renderToStaticMarkup(
      <QuestionRow question={question({ currentPosition: null, isActive: false, answerCount: 3, prompt: 'A retired prompt' })} />
    )
    expect(html).toContain('A retired prompt')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('Edit')
    expect(html).not.toContain('Replace')
    expect(html).not.toContain('Activate')
    expect(html).not.toContain('Deactivate')
    expect(html).not.toContain('Set as #')
    expect(html).not.toContain('Flagship')
  })
})
